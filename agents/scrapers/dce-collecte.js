/*
 * Agent D — collecte de l'avis officiel et du dossier de consultation (DCE)
 *
 * Appelé par l'agent D (n8n, nœud « Collecter l'avis et le DCE ») quand un client clique
 * « Analyser » sur une offre. Le script :
 *   1. lit l'avis officiel : via l'API du BOAMP pour les offres BOAMP (identifiant du type
 *      « 26-123456 »), sinon en lisant la page de la consultation sur la plateforme ;
 *   2. si demandé, récupère le DCE sur la plateforme de l'acheteur, avec un vrai navigateur
 *      (Playwright), en suivant le parcours de téléchargement ANONYME prévu par le code de la
 *      commande publique (art. R2132-2 et suivants : DCE gratuit, accès sans identification) ;
 *   3. ouvre les fichiers (zip, PDF, Word .docx, OpenDocument) et renvoie leur texte.
 *
 * Limites volontaires : le script ne contourne JAMAIS un captcha, ne crée pas de compte,
 * ne se connecte pas et ne remplit aucune information personnelle. Dans ces cas il s'arrête
 * et explique pourquoi (le client peut alors déposer les PDF lui-même).
 *
 * Plateformes reconnues : PLACE (marches-publics.gouv.fr), Maximilien, Mégalis Bretagne,
 * Ternum BFC (toutes sur la solution Atexo), AWS-Achat (marches-publics.info),
 * e-marchespublics.com, Klekoon, Marchés Online. Toute autre plateforme passe par le même
 * moteur générique (recherche des boutons « Télécharger le DCE », option anonyme, etc.).
 *
 * Usage : node dce-collecte.js <argument>
 *   <argument> = JSON {avis_id, url, objet, dce} encodé en base64 : aucune valeur venant
 *   du site n'apparaît en clair dans la ligne de commande.
 * Sortie : un objet JSON sur la sortie standard (voir resultat plus bas).
 *
 * Installation sur le PC (une seule fois, dans le dossier de ce script) :
 *   npm install playwright pdf-parse adm-zip mammoth
 *   npx playwright install chromium
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DUREE_MAX_MS = 170000;          // l'agent D attend au plus ~3 minutes
const MAX_CARACTERES = 300000;        // texte total renvoyé (avis + DCE)
const MAX_FICHIERS = 80;              // fichiers lus dans un DCE (zip compris)
const MAX_OCTETS = 150 * 1024 * 1024; // taille totale téléchargée
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const debut = Date.now();
const resultat = {
  ok: false,
  avis: { source: null, url: null, texte: '' },
  dce: { demande: false, statut: 'non_demande', plateforme: null, url: null, raison: null, fichiers: [] },
  dce_texte: '',
  erreurs: [],
  duree_s: 0
};
let deja_ecrit = false;
function terminer() {
  if (deja_ecrit) return; deja_ecrit = true;
  resultat.duree_s = Math.round((Date.now() - debut) / 1000);
  process.stdout.write(JSON.stringify(resultat));
}
const minuterie = setTimeout(() => {
  resultat.erreurs.push('Temps maximum atteint : résultat partiel.');
  if (resultat.dce.statut === 'en_cours') { resultat.dce.statut = 'erreur'; resultat.dce.raison = 'La plateforme a mis trop de temps à répondre.'; }
  terminer(); process.exit(0);
}, DUREE_MAX_MS);

/* ---------------------------------------------------------------- Arguments */
function lireArgument() {
  const brut = process.argv[2] || '';
  if (!/^[A-Za-z0-9+/=]{4,20000}$/.test(brut)) throw new Error('Argument absent ou mal formé.');
  const a = JSON.parse(Buffer.from(brut, 'base64').toString('utf8'));
  const url = String(a.url || '');
  if (url && !/^https?:\/\/[^\s"'<>`]+$/.test(url)) throw new Error('Adresse de l\'offre invalide.');
  const avis_id = String(a.avis_id || '');
  if (avis_id && !/^[A-Za-z0-9._:-]{1,120}$/.test(avis_id)) throw new Error('Identifiant d\'offre invalide.');
  return { avis_id, url, objet: String(a.objet || '').slice(0, 500), dce: !!a.dce };
}

/* ---------------------------------------------------------------- Outils texte */
const propre = s => String(s || '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
const sansBalises = s => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
// Ordre utile des pièces : règlement, CCAP, acte d'engagement, CCTP, le reste
const rangPiece = nom => { const t = String(nom).toLowerCase();
  return /r[eè]glement|\brc\b|_rc|rc[_ .-]/.test(t) ? 0 : /ccap/.test(t) ? 1 : /\bae\b|acte|engagement/.test(t) ? 2 : /cctp/.test(t) ? 3 : /bpu|dpgf|dqe/.test(t) ? 5 : 4; };

/* ---------------------------------------------------------------- 1. Avis BOAMP */
const estIdBoamp = id => /^\d{2}-\d{3,}$/.test(id);
const CLE_INUTILE = /^@|^(xmlns|schemaLocation|languageID|listName|listAgencyID|currencyID|unitCode|schemeName)$/i;
function aplatir(obj, chemin = [], lignes = [], urls = []) {
  if (lignes.length > 4000) return { lignes, urls };
  if (obj == null) return { lignes, urls };
  // Listes (lots, critères…) : le numéro est accolé au nom (« ProcurementProjectLot 2 ») pour garder le contexte
  if (Array.isArray(obj)) { obj.forEach((v, i) => aplatir(v, obj.length > 1 ? [...chemin.slice(0, -1), (chemin.at(-1) || 'Élément') + ' ' + (i + 1)] : chemin, lignes, urls)); return { lignes, urls }; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (CLE_INUTILE.test(k)) continue;
      const nom = k === '#text' || k === '$' ? null : k.replace(/^(cbc|cac|efac|efbc|efext|ext):/, '');
      aplatir(v, nom ? [...chemin, nom] : chemin, lignes, urls);
    }
    return { lignes, urls };
  }
  const val = String(obj).trim();
  if (!val) return { lignes, urls };
  if (/^https?:\/\//i.test(val)) urls.push({ url: val, chemin: chemin.join(' > ') });
  const etiquette = chemin.slice(-3).join(' > ');
  lignes.push(`${etiquette} : ${val.slice(0, 3000)}`);
  return { lignes, urls };
}
// Plateformes connues : nom affiché, et « atexo » pour celles qui utilisent la solution Atexo (même parcours)
const PLATEFORMES = [
  [/marches-publics\.gouv\.fr/i, 'PLACE (État)', 'atexo'],
  [/maximilien\.fr/i, 'Maximilien (Île-de-France)', 'atexo'],
  [/megalis\.bretagne\.bzh/i, 'Mégalis Bretagne', 'atexo'],
  [/ternum-bfc\.fr|e-bourgogne/i, 'Ternum BFC', 'atexo'],
  [/marches-publics\.info/i, 'AWS-Achat', 'aws'],
  [/e-marchespublics\.com/i, 'e-marchespublics', 'emp'],
  [/klekoon\.com/i, 'Klekoon', 'klekoon'],
  [/marchesonline\.com|achatpublic\.com/i, 'Marchés Online / achatpublic', 'mol'],
  [/achatpublic|dematis|synapse-entreprises|marches-securises|centraledesmarches|salle-des-marches|xmarches|amp-?metropole|aji-france|mpe|atexo|local-trust/i, 'Autre plateforme', 'generique']
];
const plateformeDe = url => { for (const [re, nom, type] of PLATEFORMES) if (re.test(url)) return { nom, type }; try { return { nom: new URL(url).hostname, type: 'generique' }; } catch (e) { return { nom: 'inconnue', type: 'generique' }; } };
function choisirUrlDce(urls) {
  let meilleur = null, score = 0;
  for (const { url, chemin } of urls) {
    let s = 0;
    if (/boamp\.fr|europa\.eu|ted\.|legifrance|journal-officiel|w3\.org|schema|mailto:/i.test(url)) continue;
    if (PLATEFORMES.slice(0, 8).some(([re]) => re.test(url))) s += 3;
    if (/consultation|dce|telecharg|refConsultation|DetailsConsultation|appel|avis|marche/i.test(url)) s += 2;
    if (/document|dce|URL_DOCUMENT|CallForTendersDocument|profil|URL_PROFIL|adresse.*(document|obtention)/i.test(chemin)) s += 3;
    if (/^https?:\/\/[^/]+\/?$/.test(url)) s -= 2;   // page d'accueil seule : peu utile
    if (s > score) { score = s; meilleur = url; }
  }
  return meilleur;
}
async function lireAvisBoamp(id) {
  const where = encodeURIComponent(`idweb="${id}"`);
  const r = await fetch(`https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records?where=${where}&limit=1`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('BOAMP : réponse ' + r.status);
  const rec = (await r.json()).results?.[0];
  if (!rec) return null;
  let donnees = rec.donnees; try { if (typeof donnees === 'string') donnees = JSON.parse(donnees); } catch (e) {}
  const { lignes, urls } = aplatir(donnees || {});
  const entete = [
    `Objet : ${rec.objet || ''}`, `Acheteur : ${rec.nomacheteur || ''}`, `Référence BOAMP : ${rec.idweb || id}`,
    `Date de parution : ${rec.dateparution || ''}`, `Date limite de réponse : ${rec.datelimitereponse || ''}`,
    `Type de marché : ${[].concat(rec.type_marche || []).join(', ')}`, `Procédure : ${rec.procedure_libelle || ''}`,
    `Départements : ${[].concat(rec.code_departement || []).join(', ')}`, `Domaines : ${[].concat(rec.descripteur_libelle || []).join(', ')}`
  ].join('\n');
  return { texte: entete + '\n\nDÉTAIL DE L\'AVIS\n' + lignes.join('\n'), url: rec.url_avis || null, urlDce: choisirUrlDce(urls) };
}

/* ---------------------------------------------------------------- 3. Lecture des fichiers */
let pdfParse = null, AdmZip = null, mammoth = null;
// pdf-parse : la version 2 expose une classe PDFParse, la version 1 une fonction (les deux sont acceptées)
try {
  const m = require('pdf-parse');
  if (m && m.PDFParse) pdfParse = async buf => { const p = new m.PDFParse({ data: buf }); try { const r = await p.getText(); return { text: r.text, numpages: r.total }; } finally { await (p.destroy ? p.destroy() : null); } };
  else pdfParse = typeof m === 'function' ? m : null;
} catch (e) { try { pdfParse = require('pdf-parse/lib/pdf-parse.js'); } catch (e2) {} }
if (!pdfParse) resultat.erreurs.push('Module pdf-parse absent : npm install pdf-parse');
try { AdmZip = require('adm-zip'); } catch (e) { resultat.erreurs.push('Module adm-zip absent : npm install adm-zip'); }
try { mammoth = require('mammoth'); } catch (e) { resultat.erreurs.push('Module mammoth absent : npm install mammoth'); }

const fichiersLus = [];   // {nom, texte, pages, raison}
let octetsTotal = 0;
async function lireFichier(nom, buf, profondeur = 0) {
  if (fichiersLus.length >= MAX_FICHIERS) return;
  octetsTotal += buf.length;
  if (octetsTotal > MAX_OCTETS) { fichiersLus.push({ nom, texte: null, raison: 'dossier trop volumineux, fichier ignoré' }); return; }
  const ext = path.extname(nom).toLowerCase();
  const tete = buf.slice(0, 4).toString('binary');
  try {
    if (tete === '%PDF' || ext === '.pdf') {
      if (!pdfParse) return fichiersLus.push({ nom, texte: null, raison: 'lecteur PDF non installé' });
      const d = await pdfParse(buf);
      const t = propre(d.text);
      return fichiersLus.push({ nom, texte: t.length > 50 ? t : null, pages: d.numpages, raison: t.length > 50 ? null : 'PDF sans texte (document scanné ?)' });
    }
    if (tete.startsWith('PK')) {
      if (!AdmZip) return fichiersLus.push({ nom, texte: null, raison: 'lecteur zip non installé' });
      const zip = new AdmZip(buf);
      const entrees = zip.getEntries().filter(e => !e.isDirectory);
      const noms = entrees.map(e => e.entryName);
      if (noms.includes('word/document.xml')) {
        if (!mammoth) return fichiersLus.push({ nom, texte: null, raison: 'lecteur Word non installé' });
        const t = propre((await mammoth.extractRawText({ buffer: buf })).value);
        return fichiersLus.push({ nom, texte: t || null, raison: t ? null : 'document Word vide' });
      }
      if (noms.includes('content.xml') && noms.includes('mimetype')) {   // OpenDocument (.odt, .ods)
        const t = propre(sansBalises(zip.readAsText('content.xml').replace(/<text:(p|h)[^>]*>/g, '\n')));
        return fichiersLus.push({ nom, texte: t || null, raison: t ? null : 'document vide' });
      }
      if (noms.some(n => n.startsWith('xl/'))) return fichiersLus.push({ nom, texte: null, raison: 'tableur (bordereau de prix) : non lu, à remplir' });
      if (profondeur >= 3) return fichiersLus.push({ nom, texte: null, raison: 'archive trop imbriquée' });
      for (const e of entrees) {
        if (fichiersLus.length >= MAX_FICHIERS) break;
        const base = path.basename(e.entryName);
        if (/^(\.|__MACOSX|thumbs\.db)/i.test(base) || e.entryName.includes('__MACOSX/')) continue;
        await lireFichier(e.entryName, e.getData(), profondeur + 1);
      }
      return;
    }
    if (['.txt', '.csv', '.xml', '.html', '.htm'].includes(ext)) {
      const t = propre(sansBalises(buf.toString('utf8')));
      return fichiersLus.push({ nom, texte: t || null, raison: t ? null : 'fichier vide' });
    }
    const quoi = { '.doc': 'ancien format Word (.doc)', '.xls': 'tableur', '.xlsx': 'tableur', '.dwg': 'plan (DWG)', '.dxf': 'plan (DXF)', '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.tif': 'image', '.rtf': 'format RTF' }[ext];
    fichiersLus.push({ nom, texte: null, raison: (quoi || 'format ' + (ext || 'inconnu')) + ' : non lu' });
  } catch (e) {
    fichiersLus.push({ nom, texte: null, raison: 'illisible (' + String(e.message || e).slice(0, 80) + ')' });
  }
}

/* ---------------------------------------------------------------- 2. Navigateur : parcours de téléchargement */
const RE = {
  dce: /t[ée]l[ée]charger.{0,40}(dossier|dce|pi[èe]ces|documents?|consultation)|(dossier|dce).{0,30}t[ée]l[ée]charg|dossier de (la )?consultation|retirer (le )?dce|acc[ée]der (au|aux) (dce|documents?)|consulter (le )?dce|^\s*dce\s*$|tout t[ée]l[ée]charger|t[ée]l[ée]charger tout|documents? de (la )?consultation/i,
  dceHref: /EntrepriseDemandeTelechargementDce|demandeTelechargement|telechargementDce|downloadDce|download-dce|telecharger-dce|\/dce\b|retrait|getDce|dce\.zip/i,
  eviter: /r[ée]pondre|d[ée]poser|d[ée]p[ôo]t|candidater|connexion|se connecter|s'identifier|inscri|cr[ée]er (un|mon) compte|mot de passe|panier|imprimer|rss|partager|alerte|favori|newsletter|abonn|aide|faq|contact|plan du site|mentions/i,
  valider: /^\s*(valider|continuer|confirmer|suivant|je valide|valider et t[ée]l[ée]charger|t[ée]l[ée]charger|acc[ée]der|ok)\s*$/i,
  anonyme: /anonym|sans (m'|vous )?identif|ne (pas|souhaite pas) (m'|vous )?identifier|sans inscription|sans (cr[ée]er de )?compte|t[ée]l[ée]chargement libre|acc[èe]s libre|rester anonyme/i,
  cgu: /accept|conditions (g[ée]n[ée]rales )?d'utilisation|\bcgu\b|j'ai (lu|pris connaissance)|reconnais|r[èe]glement de la plate/i,
  cguEviter: /newsletter|alerte|offres commerciales|partenaires|recevoir|informations commerciales|publicit/i,
  refusCookies: /^\s*(continuer sans accepter|tout refuser|refuser( tout)?|je refuse|non merci|refuser les cookies)\s*$/i,
  fichier: /\.(pdf|zip|docx?|odt|xlsx?|rtf)(\?|#|$)/i
};
async function etatPage(page) {
  return page.evaluate((src) => {
    const re = Object.fromEntries(Object.entries(src).map(([k, [s, f]]) => [k, new RegExp(s, f)]));
    const visible = el => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const txt = el => (el.innerText || el.value || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const html = document.documentElement.innerHTML;
    const corps = (document.body?.innerText || '');
    const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="captcha"], .g-recaptcha, .h-captcha, [id*="captcha" i], [class*="captcha" i], img[src*="captcha" i]')
      || /je ne suis pas un robot|v[ée]rification de s[ée]curit[ée]|captcha/i.test(corps.slice(0, 20000));
    const motDePasse = [...document.querySelectorAll('input[type=password]')].some(visible);
    // libellé associé à une case / un bouton radio
    const libelle = inp => { const l = inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); return ((l && l.innerText) || inp.closest('label')?.innerText || inp.parentElement?.innerText || inp.getAttribute('aria-label') || inp.id || inp.name || '').replace(/\s+/g, ' ').trim(); };
    // Repères uniques : on efface ceux d'une lecture précédente pour ne jamais cliquer sur un mauvais élément
    document.querySelectorAll('[data-lumen]').forEach(el => el.removeAttribute('data-lumen'));
    window.__lumenN = (window.__lumenN || 0) + 1000;
    let n = window.__lumenN; const marque = el => { const id = 'lumen-' + (n++); el.setAttribute('data-lumen', id); return id; };
    const cases = [...document.querySelectorAll('input[type=radio], input[type=checkbox]')].filter(i => visible(i) || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)));
    const anonyme = cases.filter(i => i.type === 'radio' && !i.checked && (re.anonyme.test(libelle(i)) || /anonym/i.test(i.id + ' ' + i.name + ' ' + i.value))).map(i => ({ id: marque(i), texte: libelle(i).slice(0, 120) }));
    const cgu = cases.filter(i => i.type === 'checkbox' && !i.checked && re.cgu.test(libelle(i)) && !re.cguEviter.test(libelle(i))).map(i => ({ id: marque(i), texte: libelle(i).slice(0, 120) }));
    const cliquables = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [onclick]')].filter(visible);
    const refus = cliquables.filter(el => re.refusCookies.test(txt(el))).map(el => ({ id: marque(el), texte: txt(el) }));
    const dce = [], valider = [], fichiers = [];
    for (const el of cliquables) {
      const t = txt(el), href = el.getAttribute('href') || '', idn = (el.id || '') + ' ' + (el.getAttribute('name') || '');
      if (href && re.fichier.test(href) && !re.eviter.test(t)) fichiers.push({ id: marque(el), texte: t.slice(0, 120), href: el.href });
      if (re.eviter.test(t) && !re.dce.test(t)) continue;
      let s = 0;
      if (re.dce.test(t)) s += 5;
      if (re.dceHref.test(href) || re.dceHref.test(idn)) s += 4;
      if (/complet/i.test(t)) s += 1;
      if (/avis/i.test(t) && !/dossier|dce/i.test(t)) s -= 4;
      if (s > 0) dce.push({ id: marque(el), texte: t.slice(0, 120), href: el.href || '', score: s });
      else if (re.valider.test(t) || /valid/i.test(idn)) valider.push({ id: marque(el), texte: t.slice(0, 60) });
    }
    dce.sort((a, b) => b.score - a.score);
    const champsIdentite = [...document.querySelectorAll('input[type=email], input[name*="mail" i], input[name*="siret" i], input[name*="nom" i]')].filter(visible).length;
    return { captcha, motDePasse, anonyme, cgu, refus, dce: dce.slice(0, 8), valider: valider.slice(0, 5), fichiers: fichiers.slice(0, 25), champsIdentite, atexo: /atexo|local-trust|EntrepriseDetailsConsultation|\/entreprise\/consultation\//i.test(location.href + html.slice(0, 50000)) };
  }, Object.fromEntries(Object.entries(RE).map(([k, r]) => [k, [r.source, r.flags]])));
}
const pause = ms => new Promise(r => setTimeout(r, ms));
async function cliquer(page, id) {
  const el = page.locator(`[data-lumen="${id}"]`).first();
  await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await el.click({ timeout: 8000 }).catch(async () => { await el.evaluate(e => e.click()).catch(() => {}); });
}
async function cocher(page, id) {
  const el = page.locator(`[data-lumen="${id}"]`).first();
  await el.check({ timeout: 5000, force: true }).catch(async () => { await el.evaluate(e => { e.checked = true; e.dispatchEvent(new Event('click', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }).catch(() => {}); });
}

async function recupererDce(url) {
  const { chromium } = require('playwright');
  const pf = plateformeDe(url);
  resultat.dce.plateforme = pf.nom; resultat.dce.url = url; resultat.dce.statut = 'en_cours';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-dce-'));
  const navigateur = await chromium.launch({ headless: true });
  const telechargements = [];
  const etapes = [];
  try {
    const ctx = await navigateur.newContext({ acceptDownloads: true, userAgent: UA, locale: 'fr-FR' });
    // Bandeaux de cookies qui bloquent les clics (même solution que l'agent E3) : on ne les charge pas.
    await ctx.route(/didomi|axeptio|cookiebot|onetrust|tarteaucitron|quantcast/i, r => r.abort());
    const pages = [];   // toutes les fenêtres ouvertes (la première comprise), chacune surveillée une seule fois
    ctx.on('page', p => { p.on('download', d => telechargements.push(d)); pages.push(p); });
    let page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Texte de la page de consultation : sert d'avis quand l'offre ne vient pas du BOAMP
    const textePage = propre(await page.evaluate(() => document.body?.innerText || '').catch(() => ''));
    const dejaClique = new Set();
    let refusFait = false, fin = null;

    for (let n = 0; n < 10 && !fin; n++) {
      if (Date.now() - debut > DUREE_MAX_MS - 40000) { fin = ['erreur', 'La plateforme a mis trop de temps à répondre.']; break; }
      // Une fenêtre s'est ouverte (lien « nouvel onglet ») : on la suit
      const derniere = pages.filter(p => !p.isClosed()).at(-1);
      if (derniere && derniere !== page) { page = derniere; await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}); }
      if (telechargements.length) break;
      const e = await etatPage(page).catch(() => null);
      if (!e) { await pause(1500); continue; }
      if (e.captcha) { fin = ['captcha', 'La plateforme affiche un captcha (« je ne suis pas un robot ») : l\'agent ne le contourne pas.']; break; }
      if (e.refus.length && !refusFait) { refusFait = true; await cliquer(page, e.refus[0].id); await pause(800); continue; }

      let action = false;
      if (e.anonyme.length) { await cocher(page, e.anonyme[0].id); etapes.push('option anonyme : ' + e.anonyme[0].texte); action = true; await pause(600); }
      for (const c of e.cgu) { await cocher(page, c.id); etapes.push('conditions acceptées : ' + c.texte); action = true; }
      if (action) {
        const e2 = await etatPage(page).catch(() => e);
        const bouton = e2.valider[0] || e2.dce.find(d => !dejaClique.has(d.texte + d.href));
        if (bouton) { if (bouton.href !== undefined) dejaClique.add(bouton.texte + bouton.href); etapes.push('clic : ' + bouton.texte); await Promise.race([page.waitForEvent('download', { timeout: 15000 }).catch(() => {}), (async () => { await cliquer(page, bouton.id); await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}); await pause(2500); })()]); }
        continue;
      }
      const cible = e.dce.find(d => !dejaClique.has(d.texte + d.href));
      if (cible) {
        dejaClique.add(cible.texte + cible.href); etapes.push('clic : ' + cible.texte);
        await cliquer(page, cible.id);
        await Promise.race([page.waitForEvent('download', { timeout: 12000 }).catch(() => {}), page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {}).then(() => pause(2500))]);
        continue;
      }
      // Pas de bouton DCE mais des liens directs vers les pièces (PDF, zip…) : on les récupère un par un
      if (e.fichiers.length) {
        for (const f of e.fichiers.slice(0, 20)) {
          try {
            const rep = await ctx.request.get(f.href, { timeout: 30000 });
            if (rep.ok()) { const corps = await rep.body(); const nom = decodeURIComponent((f.href.split('?')[0].split('/').pop() || 'piece')).slice(0, 120); await lireFichier(nom, corps); }
          } catch (err) { resultat.erreurs.push('Pièce non récupérée : ' + f.texte); }
        }
        etapes.push(e.fichiers.length + ' lien(s) direct(s) vers des pièces');
        fin = fichiersLus.length ? ['ok', null] : ['erreur', 'Les pièces listées n\'ont pas pu être téléchargées.'];
        break;
      }
      if (e.motDePasse) { fin = ['compte_requis', 'La plateforme demande de se connecter avec un compte pour télécharger le dossier.']; break; }
      if (e.champsIdentite) { fin = ['identification_requise', 'La plateforme demande vos coordonnées (nom, email, SIRET) avant le téléchargement : l\'agent ne remplit pas d\'informations à votre place.']; break; }
      fin = ['introuvable', 'Aucun bouton de téléchargement du dossier n\'a été trouvé sur la page de la consultation.'];
    }

    // Téléchargements déclenchés : on attend qu'ils finissent, puis on lit les fichiers
    if (telechargements.length) {
      for (const d of telechargements.slice(0, 10)) {
        try {
          const nom = (d.suggestedFilename() || 'dce').replace(/[^\w.\- ()À-ÿ]/g, '_').slice(0, 120);
          const chemin = path.join(dossier, nom);
          await d.saveAs(chemin);
          await lireFichier(nom, fs.readFileSync(chemin));
        } catch (err) { resultat.erreurs.push('Téléchargement interrompu : ' + String(err.message || err).slice(0, 120)); }
      }
      fin = fichiersLus.some(f => f.texte) ? ['ok', null] : ['erreur', 'Le dossier a été téléchargé mais aucun document n\'a pu être lu.'];
    }
    if (!fin) fin = ['introuvable', 'Le parcours de téléchargement n\'a pas abouti.'];
    resultat.dce.statut = fin[0]; resultat.dce.raison = fin[1];
    resultat.dce.etapes = etapes.slice(0, 12);
    return textePage;
  } finally {
    await navigateur.close().catch(() => {});
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- Principal */
async function main() {
  const arg = lireArgument();
  let urlDce = arg.url || null;

  // 1. Avis officiel
  if (estIdBoamp(arg.avis_id) || /boamp\.fr/i.test(arg.url)) {
    const id = estIdBoamp(arg.avis_id) ? arg.avis_id : ((arg.url.match(/(\d{2}-\d{3,})/) || [])[1] || '');
    try {
      const a = id ? await lireAvisBoamp(id) : null;
      if (a) { resultat.avis = { source: 'boamp', url: a.url || arg.url, texte: a.texte }; urlDce = a.urlDce; }
      else resultat.erreurs.push('Avis introuvable sur le BOAMP (' + (id || 'identifiant absent') + ').');
    } catch (e) { resultat.erreurs.push('Lecture du BOAMP impossible : ' + String(e.message || e).slice(0, 150)); }
  }

  // 2. DCE sur la plateforme de l'acheteur
  if (arg.dce) {
    resultat.dce.demande = true;
    if (!urlDce) { resultat.dce.statut = 'introuvable'; resultat.dce.raison = 'L\'avis n\'indique pas l\'adresse de la plateforme où se trouve le dossier.'; }
    else {
      try {
        const textePage = await recupererDce(urlDce);
        if (!resultat.avis.texte && textePage) resultat.avis = { source: 'page', url: urlDce, texte: textePage.slice(0, 60000) };
      } catch (e) {
        resultat.dce.statut = 'erreur';
        resultat.dce.raison = /Executable doesn't exist|playwright/i.test(String(e.message)) ? 'Navigateur automatique non installé sur le PC (npx playwright install chromium).' : 'La plateforme n\'a pas pu être ouverte (' + String(e.message || e).slice(0, 120) + ').';
      }
    }
  } else if (!resultat.avis.texte && arg.url && !/boamp\.fr/i.test(arg.url)) {
    // Pas de DCE demandé (le client a déposé ses PDF) : on lit quand même la page de l'offre
    try {
      const { chromium } = require('playwright');
      const nav = await chromium.launch({ headless: true });
      try { const p = await nav.newPage({ userAgent: UA }); await p.goto(arg.url, { waitUntil: 'domcontentloaded', timeout: 40000 }); await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        const t = propre(await p.evaluate(() => document.body?.innerText || '')); if (t) resultat.avis = { source: 'page', url: arg.url, texte: t.slice(0, 60000) };
      } finally { await nav.close(); }
    } catch (e) { resultat.erreurs.push('Page de l\'offre illisible : ' + String(e.message || e).slice(0, 120)); }
  }

  // 3. Assemblage du texte du DCE (pièces dans l'ordre utile, taille bornée)
  const lus = fichiersLus.filter(f => f.texte).sort((a, b) => rangPiece(a.nom) - rangPiece(b.nom));
  let reste = MAX_CARACTERES - resultat.avis.texte.length, morceaux = [];
  for (const f of lus) {
    if (reste <= 2000) { f.tronque = true; continue; }
    const t = f.texte.slice(0, reste);
    if (t.length < f.texte.length) f.tronque = true;
    morceaux.push(`\n\n===== FICHIER : ${f.nom}${f.pages ? ` (${f.pages} pages)` : ''} =====\n${t}`);
    reste -= t.length + 80;
  }
  resultat.dce_texte = morceaux.join('');
  resultat.dce.fichiers = fichiersLus.map(f => ({ nom: f.nom, lu: !!f.texte, caracteres: f.texte ? f.texte.length : 0, pages: f.pages || null, tronque: !!f.tronque, raison: f.raison || null }));
  if (resultat.dce.statut === 'ok' && lus.some(f => f.tronque)) resultat.dce.statut = 'partiel';
  resultat.ok = !!(resultat.avis.texte || resultat.dce_texte);
}

main().catch(e => { resultat.erreurs.push(String(e && e.message || e).slice(0, 300)); })
  .finally(() => { clearTimeout(minuterie); terminer(); process.exit(0); });
