/*
 * Agent E8 — achatpublic.com / Marchés Online (marchesonline.com)
 *
 * achatpublic.com s'est recentré sur un portail de formation/actualités ; son lien
 * "AVIS" (page d'accueil) renvoie vers marchesonline.com, qui héberge la vraie liste
 * publique des appels d'offres (en-cours), nationale, sans connexion requise — vérifié
 * en direct : 13 750 avis, répartis dans toute la France (17, 62, 85, 92, 63, 75, 59,
 * 42, 07, 13...), triés du plus récent au plus ancien, pagination simple par
 * /appels-offres/en-cours?page=N (contrairement à e-marchespublics/E3, ce paramètre
 * fonctionne réellement ici).
 *
 * Chaque carte de résultat donne, en texte brut et dans un ordre fixe : acheteur, objet,
 * "DD - Ville" (département + ville), catégorie, procédure, "DCE en ligne" (optionnel),
 * "Mise en ligne : DD/MM/AAAA", "Limite de réponse : DD/MM/AAAA" — d'où le parsing
 * ligne-à-ligne plutôt que des sélecteurs CSS fragiles (la page est une SPA Vue avec
 * des classes utilitaires non significatives).
 *
 * Usage : node e8-achatpublic.js
 * Sortie : un objet JSON {offres, total, erreur} sur la sortie standard.
 */
const { chromium } = require('playwright');

const BASE = 'https://www.marchesonline.com';
const MAX_PAGES = 8; // ~160 annonces les plus récentes ; le upsert sur avis_id dédoublonne d'un passage à l'autre.

function dateIso(jjmmaaaa) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((jjmmaaaa || '').trim());
  if (!m) return null;
  const [, j, mo, a] = m;
  return `${a}-${mo}-${j}`;
}

async function main() {
  const navigateur = await chromium.launch({ headless: true });
  const page = await navigateur.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const erreurs = [];
  let toutesLignes = [];
  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = p === 1 ? `${BASE}/appels-offres/en-cours` : `${BASE}/appels-offres/en-cours?page=${p}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('h2 a.jqUpdateLink', { timeout: 20000 }).catch(() => {});
        const lignes = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('div').forEach(d => {
            if (!(d.className.includes('box-shadow-neutral-2') && d.className.includes('justify-between'))) return;
            const lien = d.querySelector('h2 a.jqUpdateLink');
            if (!lien) return;
            const lignesTxt = d.innerText.split('\n').map(s => s.trim()).filter(Boolean);
            out.push({
              href: lien.getAttribute('href'),
              lignes: lignesTxt
            });
          });
          return out;
        });
        if (!lignes.length) break;
        toutesLignes = toutesLignes.concat(lignes);
      } catch (e) {
        erreurs.push(`page ${p} : ${String(e && e.message || e)}`);
      }
    }
  } catch (e) {
    erreurs.push(String(e && e.message || e));
  } finally {
    await navigateur.close();
  }

  const vus = new Set();
  const offres = toutesLignes.filter(l => l.href && !vus.has(l.href) && vus.add(l.href)).map(l => {
    const t = l.lignes;
    const acheteur = t[0] || '';
    const objet = t[1] || '';
    const lieuLigne = t.find(x => /^\d{2,3}[AB]?\s*-\s*/.test(x)) || '';
    const lieuMatch = /^(\d{2,3}[AB]?)\s*-\s*(.*)$/.exec(lieuLigne);
    const dep = lieuMatch?.[1] || null;
    const ville = lieuMatch?.[2] || null;
    const categorie = t.find(x => !/^\d{2,3}[AB]?\s*-\s*/.test(x) && /^(Travaux|Fournitures|Services|Etudes|Prestations)/i.test(x) && !/procédure/i.test(x)) || null;
    const procedure = t.find(x => /procédure|appel d.offres|concours|dialogue|négocié/i.test(x)) || null;
    const miseEnLigne = t.find(x => /^Mise en ligne/i.test(x));
    const limiteRep = t.find(x => /^Limite de réponse/i.test(x));
    const parution = miseEnLigne ? dateIso(miseEnLigne.split(':')[1]?.trim()) : null;
    const limite = limiteRep ? dateIso(limiteRep.split(':')[1]?.trim()) : null;
    const idMatch = /\/ao-(\d+)-\d+$/.exec(l.href);
    return {
      avis_id: `APC-${idMatch ? idMatch[1] : l.href.replace(/\W+/g, '-')}`,
      objet: objet.slice(0, 1000),
      acheteur: acheteur.slice(0, 300),
      departements: dep ? [dep] : [],
      lieu: ville ? `${dep ? '(' + dep + ') ' : ''}${ville}`.slice(0, 200) : null,
      type_marche: categorie ? categorie.toUpperCase() : null,
      procedure,
      descripteurs: null,
      montant: null,
      duree_mois: null,
      nb_lots: null,
      parution,
      limite: limite ? `${limite}T12:00:00+01:00` : null,
      url: BASE + l.href
    };
  });

  process.stdout.write(JSON.stringify({ offres, total: offres.length, erreur: erreurs.length ? erreurs.join(' | ') : null }));
}

main().catch(e => { process.stdout.write(JSON.stringify({ offres: [], total: 0, erreur: String(e && e.message || e) })); process.exit(0); });
