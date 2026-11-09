/*
 * Agent E6 — e-Bourgogne / Ternum BFC (marches.ternum-bfc.fr)
 *
 * "e-Bourgogne" a été rebaptisée "Ternum BFC" (Bourgogne-Franche-Comté) — confirmé via
 * un avis BOAMP récent qui pointe vers marches.ternum-bfc.fr. Même moteur Atexo/PRADO que
 * PLACE (agent E1) et Maximilien (agent E4) : formulaire de recherche avancée identique
 * (mêmes id ctl0_CONTENU_PAGE_...), mêmes cartes .item_consultation, même pagination, même
 * lien "Accéder à la consultation" sans préfixe /app.php/entreprise/.
 *
 * Couverture : essentiellement Bourgogne-Franche-Comté avec quelques organismes à
 * portée nationale hébergés dessus (État - Place de Marché Interministérielle...).
 * Aucun filtre géographique appliqué, conformément à la consigne "toute la France" :
 * on prend la couverture telle que la plateforme la propose nativement.
 *
 * Usage : node e6-ebourgogne.js
 * Sortie : un objet JSON {offres, total, erreur} sur la sortie standard.
 *
 * Installation requise sur le PC (une seule fois, partagée avec les autres sous-agents) :
 *   npm install playwright
 *   npx playwright install chromium
 */
const { chromium } = require('playwright');

const BASE = 'https://marches.ternum-bfc.fr';
const MAX_PAGES = 8; // ~160 annonces les plus récentes ; le upsert sur avis_id dédoublonne d'un passage à l'autre.

// Abréviations françaises de mois, longueur variable selon le mois ("Janv.", "Fév.", "Mars", "Avr.", ...) :
// on enlève les accents et le point puis on teste des préfixes, plutôt que de supposer une longueur fixe.
const MOIS_PREFIXES = [['janv', 1], ['fevr', 2], ['fev', 2], ['mars', 3], ['avr', 4], ['mai', 5], ['juin', 6], ['juil', 7], ['aout', 8], ['sept', 9], ['oct', 10], ['nov', 11], ['dec', 12]];
function moisDe(moisTxt) {
  const t = (moisTxt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').trim();
  const trouve = MOIS_PREFIXES.find(([prefixe]) => t.startsWith(prefixe));
  return trouve ? trouve[1] : null;
}
function dateIso(jour, moisTxt, annee) {
  const m = moisDe(moisTxt);
  if (!m || !jour || !annee) return null;
  return `${annee}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}
// "25 Nov. 2025" ou "5 Janv. 2036 16:00" → { date: "2025-11-25", heure: "16:00" | null }
function parseDateFr(txt) {
  const m = /(\d{1,2})\s+([A-Za-zéû.]+)\.?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(txt || '');
  if (!m) return { date: null, heure: null };
  return { date: dateIso(m[1], m[2], m[3]), heure: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null };
}
function departementsDe(txt) {
  return Array.from(new Set(((txt || '').match(/\((\d{2,3}[AB]?)\)/g) || []).map(s => s.replace(/[()]/g, ''))));
}

async function main() {
  const navigateur = await chromium.launch({ headless: true });
  const page = await navigateur.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const erreurs = [];
  let toutesLignes = [];
  try {
    await page.goto(`${BASE}/?page=Entreprise.EntrepriseAdvancedSearch`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.click('#ctl0_CONTENU_PAGE_AdvancedSearch_lancerRecherche')
    ]);

    for (let p = 0; p < MAX_PAGES; p++) {
      const nb = await page.locator('.item_consultation').count();
      if (!nb) break;
      const lignes = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.item_consultation').forEach(card => {
          const refCons = card.querySelector('[id*="refCons"]')?.value || null;
          const orgCons = card.querySelector('[id*="orgCons"]')?.value || null;
          if (!refCons) return;
          const objetLbl = Array.from(card.querySelectorAll('*')).find(el => el.textContent.trim() === 'Objet :');
          const orgLbl = Array.from(card.querySelectorAll('*')).find(el => el.textContent.trim().startsWith('Organisme :') && el.children.length <= 1);
          const accesLink = Array.from(card.querySelectorAll('a')).find(a => /accéder à la consultation/i.test(a.textContent));
          out.push({
            refCons, orgCons,
            titre: card.querySelector('.objet-line')?.textContent.replace(/\s+/g, ' ').trim() || null,
            objet: objetLbl?.nextElementSibling?.textContent.replace(/\s+/g, ' ').trim() || null,
            acheteur: orgLbl?.textContent.replace(/\s+/g, ' ').trim().replace(/^Organisme\s*:\s*/, '') || null,
            lieux: card.querySelector('.lieux-exe')?.textContent.replace(/\s+/g, ' ').trim() || null,
            categorie: card.querySelector('.cons_categorie')?.textContent.trim() || null,
            procedure: card.querySelector('.cons_procedure')?.textContent.trim() || null,
            dateMin: card.querySelector('.date-min')?.textContent.replace(/\s+/g, ' ').trim() || null,
            dateEnd: card.querySelector('.cons_dateEnd')?.textContent.replace(/\s+/g, ' ').trim() || null,
            nbLots: card.textContent.match(/(\d+)\s*lots?/)?.[1] || null,
            url: accesLink?.getAttribute('href') || null
          });
        });
        return out;
      });
      toutesLignes = toutesLignes.concat(lignes);

      const suivant = page.locator('#ctl0_CONTENU_PAGE_resultSearch_PagerTop_ctl3');
      if (p === MAX_PAGES - 1 || !(await suivant.count())) break;
      const premierAvant = lignes[0]?.refCons;
      await suivant.click();
      await page.waitForFunction(
        (avant) => document.querySelector('.item_consultation [id*="refCons"]')?.value !== avant,
        premierAvant, { timeout: 20000 }
      ).catch(() => {});
    }
  } catch (e) {
    erreurs.push(String(e && e.message || e));
  } finally {
    await navigateur.close();
  }

  const vus = new Set();
  const offres = toutesLignes.filter(l => l.refCons && !vus.has(l.refCons) && vus.add(l.refCons)).map(l => {
    const pub = parseDateFr(l.dateMin);
    const lim = parseDateFr(l.dateEnd);
    const deps = departementsDe(l.lieux);
    return {
      avis_id: `TBFC-${l.refCons}`,
      objet: (l.objet || l.titre || '').slice(0, 1000),
      acheteur: (l.acheteur || '').slice(0, 300),
      departements: deps,
      lieu: l.lieux ? l.lieux.replace(/\s*\.\.\.\s*$/, '').slice(0, 200) : null,
      type_marche: l.categorie ? l.categorie.toUpperCase() : null,
      procedure: l.procedure || null,
      descripteurs: null,
      montant: null,
      duree_mois: null,
      nb_lots: l.nbLots ? Number(l.nbLots) : null,
      parution: pub.date,
      limite: lim.date ? `${lim.date}T${lim.heure || '12:00'}:00+01:00` : null,
      url: l.url && l.url.startsWith('http') ? l.url : (l.refCons ? `${BASE}/entreprise/consultation/${l.refCons}?orgAcronyme=${l.orgCons || ''}` : null)
    };
  });

  process.stdout.write(JSON.stringify({ offres, total: offres.length, erreur: erreurs[0] || null }));
}

main().catch(e => { process.stdout.write(JSON.stringify({ offres: [], total: 0, erreur: String(e && e.message || e) })); process.exit(0); });
