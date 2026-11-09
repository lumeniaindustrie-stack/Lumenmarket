/*
 * Agent E2 — AWS-Achat (marches-publics.info)
 *
 * Ce site renvoie une page vide ("veuillez préciser votre recherche") à toute
 * requête HTTP classique (comme celle que fait l'agent A sur le BOAMP) : il
 * ne sert la vraie liste qu'à un navigateur qui a réellement cliqué sur
 * "Rechercher". D'où ce script Playwright, qui pilote un vrai navigateur
 * headless pour remplir et soumettre le formulaire comme un humain.
 *
 * Usage : node e2-aws.js
 * Sortie : un tableau JSON (une ligne, sur la sortie standard) d'offres
 *          prêtes à insérer dans la table Supabase "offres".
 *
 * Installation requise sur le PC (une seule fois) :
 *   npm install playwright
 *   npx playwright install chromium
 */
const { chromium } = require('playwright');

const BASE = 'https://www.marches-publics.info';
// Le site refuse d'afficher les résultats au-delà d'un certain volume ("Veuillez préciser votre
// recherche") : il faut donc filtrer par date ET par département, pas seulement par date.
const FENETRE = ' < 8'; // "8 derniers jours" — recouvrement suffisant pour une veille quotidienne, le upsert sur avis_id dédoublonne.
const DEPARTEMENTS_IDR = '4,5,6,13,83,84'; // Région PACA (04,05,06,13,83,84) — zone de Lumen (voir config.js DEPARTEMENTS_ACCUEIL).

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

async function main() {
  const navigateur = await chromium.launch({ headless: true });
  const page = await navigateur.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const erreurs = [];
  let lignes = [];
  try {
    await page.goto(`${BASE}/Annonces/rechercher`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.selectOption('#dateParution', FENETRE);
    await page.selectOption('select[name="IDR"]', DEPARTEMENTS_IDR);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.click('#sub')
    ]);

    // Si le site nous recale malgré tout sur la page de filtres, pas de résultats cette fois.
    const titreOk = await page.locator('#nbResultAvis').count();
    if (!titreOk) throw new Error("Page de résultats non obtenue (probablement recalé sur la page de filtres).");

    lignes = await page.evaluate(() => {
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
  } catch (e) {
    erreurs.push(String(e && e.message || e));
  } finally {
    await navigateur.close();
  }

  const offres = lignes.filter(l => l.href).map(l => {
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

  process.stdout.write(JSON.stringify({ offres, total: offres.length, erreur: erreurs[0] || null }));
}

main().catch(e => { process.stdout.write(JSON.stringify({ offres: [], total: 0, erreur: String(e && e.message || e) })); process.exit(0); });
