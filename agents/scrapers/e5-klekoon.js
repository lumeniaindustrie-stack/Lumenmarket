/*
 * Agent E5 — Klekoon (klekoon.com)
 *
 * Klekoon héberge sa propre plate-forme de dématérialisation (marchés publics "natifs"
 * Klekoon, distincts du BOAMP/JOUE qu'elle agrège aussi pour sa "veille" mais que les
 * agents A et E1-E4 couvrent déjà par ailleurs — on ne récupère donc ici QUE les avis
 * publiés nativement sur Klekoon, pour ne pas dupliquer les autres agents).
 *
 * Couverture nationale : la page "/liste-annonces-acheteur-public" liste, sur une seule
 * page sans pagination, tous les acheteurs publics ayant au moins une consultation en
 * cours sur Klekoon — vérifié en direct : ~58 acheteurs répartis dans toute la France
 * (Maisons-Alfort, Beauvais, Troyes, Alençon, Volgelsheim, Vescovato...), donc aucun
 * filtre géographique à poser.
 *
 * Pour chaque acheteur on visite sa page (liste de ses consultations en cours), qui
 * donne directement Nom/Émetteur (avec le département entre parenthèses)/Source
 * (le type de procédure)/Parution/Clôture — on ne va pas jusqu'à la page de détail de
 * chaque avis (trop de requêtes pour le gain), donc la catégorie de marché, le lieu
 * précis et l'heure de clôture ne sont pas disponibles ici (comme pour d'autres agents,
 * certains champs restent à null).
 *
 * Usage : node e5-klekoon.js
 * Sortie : un objet JSON {offres, total, erreur} sur la sortie standard.
 */
const { chromium } = require('playwright');

const BASE = 'https://www.klekoon.com';

// "DD/MM/YYYY" → "YYYY-MM-DD"
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
    await page.goto(`${BASE}/liste-annonces-acheteur-public`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const acheteurs = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('table tr').forEach(tr => {
        const a = tr.querySelector('td a[href*="/acheteurs-publics/"]');
        if (a) out.push(a.getAttribute('href'));
      });
      return out;
    });

    for (const href of acheteurs) {
      try {
        await page.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const lignes = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('table tr[id]').forEach(tr => {
            const id = tr.id;
            const lien = tr.querySelector('td a[href*="/appels-offres/avis/"]');
            const tds = tr.querySelectorAll('td');
            out.push({
              id,
              nom: lien?.textContent.replace(/\s+/g, ' ').trim() || null,
              url: lien?.getAttribute('href') || null,
              emetteur: tds[1]?.textContent.replace(/\s+/g, ' ').trim() || null,
              source: tds[2]?.textContent.replace(/\s+/g, ' ').trim() || null,
              parution: tds[3]?.textContent.replace(/\s+/g, ' ').trim() || null,
              cloture: tds[4]?.textContent.replace(/\s+/g, ' ').trim() || null
            });
          });
          return out;
        });
        toutesLignes = toutesLignes.concat(lignes);
      } catch (e) {
        erreurs.push(`${href} : ${String(e && e.message || e)}`);
      }
    }
  } catch (e) {
    erreurs.push(String(e && e.message || e));
  } finally {
    await navigateur.close();
  }

  const vus = new Set();
  const offres = toutesLignes.filter(l => l.id && !vus.has(l.id) && vus.add(l.id)).map(l => {
    const depMatch = /\((\d{2,3}[AB]?)\)\s*$/.exec(l.emetteur || '');
    const dep = depMatch?.[1] || null;
    const acheteur = (l.emetteur || '').replace(/\s*\(\d{2,3}[AB]?\)\s*$/, '').trim();
    const procedure = (l.source || '').replace(/^Klekoon\s*-\s*/i, '').trim() || null;
    return {
      avis_id: `KLK-${l.id}`,
      objet: (l.nom || '').slice(0, 1000),
      acheteur: acheteur.slice(0, 300),
      departements: dep ? [dep] : [],
      lieu: null,
      type_marche: null,
      procedure,
      descripteurs: null,
      montant: null,
      duree_mois: null,
      nb_lots: null,
      parution: dateIso(l.parution),
      limite: dateIso(l.cloture) ? `${dateIso(l.cloture)}T12:00:00+01:00` : null,
      url: l.url ? BASE + l.url : null
    };
  });

  process.stdout.write(JSON.stringify({ offres, total: offres.length, erreur: erreurs.length ? erreurs.join(' | ') : null }));
}

main().catch(e => { process.stdout.write(JSON.stringify({ offres: [], total: 0, erreur: String(e && e.message || e) })); process.exit(0); });
