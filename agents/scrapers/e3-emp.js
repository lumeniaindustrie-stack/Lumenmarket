/*
 * Agent E3 — e-marchespublics.com (éditeur Agysoft)
 *
 * Couverture nationale (toute la France) : liste générale /appel-offre/, déjà triée du
 * plus récent au plus ancien, sans filtre de région ni de département.
 *
 * Piège repéré en testant en direct : le site affiche un bandeau de consentement cookies
 * qui bloque le rendu du contenu réel jusqu'à ce qu'on clique "Continuer sans accepter" —
 * sans ce clic, la page paraît vide. La pagination, elle, est en JavaScript (AJAX) : on
 * clique la vraie flèche ">" comme le ferait un humain, plutôt que d'appeler la fonction
 * JS ou de changer l'URL (un paramètre ?page=N est ignoré par le site).
 *
 * Le nombre total affiché ("1152 appels d'offres", "116 pages") n'est pas fiable pour
 * borner la pagination (il ne change pas selon le filtre) : on se limite donc aux
 * premières pages (recouvrement large, upsert sur avis_id dédoublonne).
 *
 * Usage : node e3-emp.js
 * Sortie : un objet JSON {offres, total, erreur} sur la sortie standard.
 */
const { chromium } = require('playwright');

const BASE = 'https://www.e-marchespublics.com';
const URL_NATIONALE = `${BASE}/appel-offre/`;
const MAX_PAGES = 8; // ~80 annonces les plus récentes à l'échelle nationale ; le upsert sur avis_id dédoublonne.

const MOIS_PREFIXES = [['janv', 1], ['fevr', 2], ['fev', 2], ['mars', 3], ['avr', 4], ['mai', 5], ['juin', 6], ['juil', 7], ['aout', 8], ['sept', 9], ['oct', 10], ['nov', 11], ['dec', 12]];
function departementDe(cp) {
  if (!cp) return null;
  if (/^9[78]\d/.test(cp)) return cp.slice(0, 3);
  return cp.slice(0, 2);
}
// "14/12/2026 à 16h00" → "2026-12-14T16:00:00+01:00"
function dateIsoFr(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\s*à\s*(\d{1,2})h(\d{2}))?/.exec(txt || '');
  if (!m) return null;
  const [, j, mo, a, h, mi] = m;
  return `${a}-${mo}-${j}T${(h || '12').padStart(2, '0')}:${(mi || '00').padStart(2, '0')}:00+01:00`;
}

async function main() {
  const navigateur = await chromium.launch({ headless: true });
  const page = await navigateur.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const erreurs = [];
  let toutesLignes = [];
  try {
    await page.goto(URL_NATIONALE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => {
      const lien = Array.from(document.querySelectorAll('a,button,div,span')).find(el => el.textContent.trim().startsWith('Continuer sans accepter'));
      if (lien) lien.click();
    });
    await page.waitForSelector('.box', { timeout: 30000 });

    for (let p = 0; p < MAX_PAGES; p++) {
      const nb = await page.locator('.box').count();
      if (!nb) break;
      const lignes = await page.evaluate(() => Array.from(document.querySelectorAll('.box')).map(box => {
        const col1ps = box.querySelectorAll('.col1 p');
        const dates = Array.from(box.querySelectorAll('.col3 p')).map(p => p.textContent.replace(/\s+/g, ' ').trim());
        return {
          titre: box.querySelector('.box-header-title .texttruncate')?.textContent.trim() || null,
          acheteur: box.querySelector('.box-body-top > span')?.textContent.trim() || null,
          lieuTxt: col1ps[0]?.textContent.replace(/\s+/g, ' ').trim() || null,
          typeTxt: col1ps[1]?.textContent.replace(/\s+/g, ' ').trim() || null,
          dateOffre: dates.find(d => /de l.offre/i.test(d)) || null,
          dateCandidature: dates.find(d => /de candidature/i.test(d)) || null,
          avisHref: box.querySelector('a.notice-a[href*="/appel-offre/"]')?.getAttribute('href') || null
        };
      }));
      toutesLignes = toutesLignes.concat(lignes);

      const suivant = page.locator('.pages-prev.pages-up .fa-angle-right:not(.disabled)');
      if (p === MAX_PAGES - 1 || !(await suivant.count())) break;
      const premierAvant = lignes[0]?.avisHref;
      await suivant.first().click();
      await page.waitForFunction(
        (avant) => document.querySelector('.box a.notice-a[href*="/appel-offre/"]')?.getAttribute('href') !== avant,
        premierAvant, { timeout: 20000 }
      ).catch(() => {});
    }
  } catch (e) {
    erreurs.push(String(e && e.message || e));
  } finally {
    await navigateur.close();
  }

  const vus = new Set();
  const offres = toutesLignes.filter(l => l.avisHref && !vus.has(l.avisHref) && vus.add(l.avisHref)).map(l => {
    const cpMatch = /^(\d{5})\s+(.*)$/.exec(l.lieuTxt || '');
    const cp = cpMatch?.[1] || null;
    const ville = cpMatch?.[2] || l.lieuTxt;
    const dep = departementDe(cp);
    const [typeBrut, procedure] = (l.typeTxt || '').split(' - ').map(s => s?.trim());
    const idSegs = l.avisHref.split('/').filter(Boolean).slice(-2).join('-');
    const limiteTxt = l.dateOffre || l.dateCandidature;
    return {
      avis_id: `EMP-${idSegs}`,
      objet: (l.titre || '').slice(0, 1000),
      acheteur: (l.acheteur || '').slice(0, 300),
      departements: dep ? [dep] : [],
      lieu: ville ? `${cp ? '(' + dep + ') ' : ''}${ville}`.slice(0, 200) : null,
      type_marche: typeBrut ? typeBrut.toUpperCase() : null,
      procedure: procedure || null,
      descripteurs: null,
      montant: null,
      duree_mois: null,
      nb_lots: null,
      parution: null,
      limite: dateIsoFr(limiteTxt),
      url: BASE + l.avisHref
    };
  });

  process.stdout.write(JSON.stringify({ offres, total: offres.length, erreur: erreurs[0] || null }));
}

main().catch(e => { process.stdout.write(JSON.stringify({ offres: [], total: 0, erreur: String(e && e.message || e) })); process.exit(0); });
