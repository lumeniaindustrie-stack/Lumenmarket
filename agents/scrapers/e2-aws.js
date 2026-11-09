/*
 * Agent E2 — AWS-Achat (marches-publics.info)
 *
 * Ce site renvoie une page vide ("veuillez préciser votre recherche") à toute requête
 * HTTP classique (comme celle que fait l'agent A sur le BOAMP) : il ne sert la vraie
 * liste qu'à un navigateur qui a réellement cliqué sur "Rechercher". D'où ce script
 * Playwright, qui pilote un vrai navigateur headless pour remplir et soumettre le
 * formulaire comme un humain.
 *
 * Couverture nationale : le site refuse d'afficher les résultats au-delà d'un certain
 * volume ("Veuillez préciser votre recherche") dès qu'aucun filtre géographique n'est
 * posé (testé en direct : 3405 résultats nationaux sans filtre, contre 68 pour la seule
 * région PACA sur 8 jours) — impossible donc de tout demander en une fois. Le script
 * relance donc une recherche par région (les 14 régions de la liste déroulante "IDR",
 * DOM compris) et additionne les résultats ; si une région dépasse encore le seuil du
 * site, son erreur est notée mais n'interrompt pas les autres régions.
 *
 * Usage : node e2-aws.js
 * Sortie : un objet JSON {offres, total, erreur} sur la sortie standard.
 *
 * Installation requise sur le PC (une seule fois) :
 *   npm install playwright
 *   npx playwright install chromium
 */
const { chromium } = require('playwright');

const BASE = 'https://www.marches-publics.info';
const FENETRE = ' < 8'; // "8 derniers jours" — recouvrement suffisant pour une veille quotidienne, le upsert sur avis_id dédoublonne.

// Les 14 régions de la liste déroulante "Départements" (valeur = codes départements qu'elle regroupe).
const REGIONS = [
  ['AUVERGNE-RHONE-ALPES', '1,3,7,15,26,38,42,43,63,69,73,74'],
  ['BOURGOGNE-FRANCHE-COMTE', '21,25,39,58,70,71,89,90'],
  ['BRETAGNE', '22,29,35,56'],
  ['CENTRE-VAL DE LOIRE', '18,28,36,37,41,45'],
  ['CORSE', '201,202'],
  ['DOM', '971,972,973,974,975,976'],
  ['GRAND EST', '8,10,51,52,54,55,57,67,68,88'],
  ['HAUTS-DE-FRANCE', '2,59,60,62,80'],
  ['ILE-DE-FRANCE', '75,77,78,91,92,93,94,95'],
  ['NORMANDIE', '14,27,50,61,76'],
  ['NOUVELLE AQUITAINE', '16,17,19,23,24,33,40,47,64,79,86,87'],
  ['OCCITANIE', '9,11,12,30,31,32,34,46,48,65,66,81,82'],
  ['PAYS-DE-LOIRE', '44,49,53,72,85'],
  ["PROVENCE-ALPES-COTE D'AZUR", '4,5,6,13,83,84']
];

// Devine l'année complète à partir d'une date "JJ/MM/AA" (le site n'utilise que 2 chiffres).
function dateIso(jjmmaa) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec((jjmmaa || '').trim());
  if (!m) return null;
  const [, j, mo, a] = m;
  return `20${a}-${mo}-${j}`;
}

// Devine le département depuis un code postal (DOM-TOM sur 3 chiffres, le reste sur les 2 premiers).
function departementDe(cp) {
  if (!cp) return null;
  if (/^9[78]\d/.test(cp)) return cp.slice(0, 3);
  if (/^20/.test(cp)) return cp.slice(0, 2); // Corse (2A/2B approximés par "20" au code postal)
  return cp.slice(0, 2);
}

async function chercherRegion(page, idr, fenetre) {
  await page.goto(`${BASE}/Annonces/rechercher`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.selectOption('#dateParution', fenetre);
  await page.selectOption('select[name="IDR"]', idr);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    page.click('#sub')
  ]);
  const titreOk = await page.locator('#nbResultAvis').count();
  if (!titreOk) throw new Error('Page de résultats non obtenue (probablement recalé sur la page de filtres).');

  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('h2.h2-avis').forEach(h2 => {
      const bloc = h2.closest('.container-fluid');
      if (!bloc) return;
      const onglet = bloc.closest('.tab-pane')?.id; // "1" travaux, "2" services, "3" fournitures
      const type = { 1: 'TRAVAUX', 2: 'SERVICES', 3: 'FOURNITURES' }[onglet] || null;
      const dateTxt = bloc.querySelector('.affiche_date_avis')?.textContent.replace(/\s+/g, ' ').trim() || '';
      const pub = dateTxt.match(/Publié le\s*([\d/]+)/)?.[1] || null;
      const lim = dateTxt.match(/Date limite\s*:\s*le\s*([\d/]+)(?:\s*à\s*(\d{1,2})h(\d{2}))?/);
      const acheteurTxt = h2.textContent.replace(/\s+/g, ' ').trim();
      const cp = acheteurTxt.match(/\((\d{4,5})\)\s*$/)?.[1] || null;
      const acheteur = acheteurTxt.replace(/\s*\(\d{4,5}\)\s*$/, '').trim();
      const titreBox = bloc.querySelector('#titre_box');
      let objet = titreBox ? titreBox.textContent.replace(/\s+/g, ' ').trim() : '';
      const nbLots = objet.match(/Marché alloti\s*:\s*(\d+)\s*lots?/i)?.[1] || null;
      objet = objet.replace(/^\[réf\.\s*[^\]]*\]\s*/i, '').replace(/\[Marché alloti[^\]]*\]\s*$/i, '').trim();
      const href = bloc.querySelector('a[href^="/Annonces/"][href$=".htm"]')?.getAttribute('href') || null;
      out.push({ href, acheteur, cp, objet, type, pub, lim: lim ? lim[1] : null, limH: lim?.[2] || null, limM: lim?.[3] || null });
    });
    return out;
  });
}

async function main() {
  const navigateur = await chromium.launch({ headless: true });
  const page = await navigateur.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const erreurs = [];
  let toutesLignes = [];
  try {
    for (const [nom, idr] of REGIONS) {
      try {
        const lignes = await chercherRegion(page, idr, FENETRE);
        toutesLignes = toutesLignes.concat(lignes);
      } catch (e) {
        // Région trop dense pour la fenêtre de 8 jours (seuil "veuillez préciser" du
        // site) : on retente une fois avec une fenêtre plus courte avant d'abandonner.
        try {
          const lignes = await chercherRegion(page, idr, ' < 2');
          toutesLignes = toutesLignes.concat(lignes);
        } catch (e2) {
          erreurs.push(`${nom} : ${String(e2 && e2.message || e2)}`);
        }
      }
    }
  } catch (e) {
    erreurs.push(String(e && e.message || e));
  } finally {
    await navigateur.close();
  }

  const vus = new Set();
  const offres = toutesLignes.filter(l => l.href && !vus.has(l.href) && vus.add(l.href)).map(l => {
    const id = l.href.replace(/^\/Annonces\//, '').replace(/\.htm$/, '');
    const dep = departementDe(l.cp);
    const limIso = l.lim ? dateIso(l.lim) : null;
    const limite = limIso ? `${limIso}T${(l.limH || '12').padStart(2, '0')}:${(l.limM || '00').padStart(2, '0')}:00+01:00` : null;
    return {
      avis_id: `AWS-${id}`,
      objet: l.objet.slice(0, 1000),
      acheteur: l.acheteur.slice(0, 300),
      departements: dep ? [dep] : [],
      lieu: l.cp || null,
      type_marche: l.type,
      procedure: null,
      descripteurs: null,
      montant: null,
      duree_mois: null,
      nb_lots: l.nbLots ? Number(l.nbLots) : null,
      parution: dateIso(l.pub),
      limite,
      url: BASE + l.href
    };
  });

  process.stdout.write(JSON.stringify({ offres, total: offres.length, erreur: erreurs.length ? erreurs.join(' | ') : null }));
}

main().catch(e => { process.stdout.write(JSON.stringify({ offres: [], total: 0, erreur: String(e && e.message || e) })); process.exit(0); });
