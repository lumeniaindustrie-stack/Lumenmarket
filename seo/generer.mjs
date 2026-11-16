// =====================================================================
//  Lumen Marchés — pages de référencement « appels d'offres par métier et département »
//  Lit toutes les consultations ouvertes du BOAMP (une seule requête d'export), les classe par
//  métier et par département, puis écrit des pages HTML statiques dans site/marches-publics/
//  et met à jour site/sitemap.xml. Lancé chaque matin par GitHub Actions (.github/workflows/seo.yml).
//  Test local : FIXTURE=chemin/vers/fichier.json node seo/generer.mjs
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(RACINE, "site");
const SORTIE = path.join(SITE, "marches-publics");
const URL_SITE = "https://lumen-marche.fr";
const BOAMP = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/exports/json";
const CHAMPS = "idweb,objet,nomacheteur,type_marche,descripteur_libelle,code_departement,dateparution,datelimitereponse,procedure_libelle,url_avis";

const DEPTS = Object.fromEntries(("01 Ain|02 Aisne|03 Allier|04 Alpes-de-Haute-Provence|05 Hautes-Alpes|06 Alpes-Maritimes|07 Ardèche|08 Ardennes|09 Ariège|10 Aube|11 Aude|12 Aveyron|13 Bouches-du-Rhône|14 Calvados|15 Cantal|16 Charente|17 Charente-Maritime|18 Cher|19 Corrèze|2A Corse-du-Sud|2B Haute-Corse|21 Côte-d'Or|22 Côtes-d'Armor|23 Creuse|24 Dordogne|25 Doubs|26 Drôme|27 Eure|28 Eure-et-Loir|29 Finistère|30 Gard|31 Haute-Garonne|32 Gers|33 Gironde|34 Hérault|35 Ille-et-Vilaine|36 Indre|37 Indre-et-Loire|38 Isère|39 Jura|40 Landes|41 Loir-et-Cher|42 Loire|43 Haute-Loire|44 Loire-Atlantique|45 Loiret|46 Lot|47 Lot-et-Garonne|48 Lozère|49 Maine-et-Loire|50 Manche|51 Marne|52 Haute-Marne|53 Mayenne|54 Meurthe-et-Moselle|55 Meuse|56 Morbihan|57 Moselle|58 Nièvre|59 Nord|60 Oise|61 Orne|62 Pas-de-Calais|63 Puy-de-Dôme|64 Pyrénées-Atlantiques|65 Hautes-Pyrénées|66 Pyrénées-Orientales|67 Bas-Rhin|68 Haut-Rhin|69 Rhône|70 Haute-Saône|71 Saône-et-Loire|72 Sarthe|73 Savoie|74 Haute-Savoie|75 Paris|76 Seine-Maritime|77 Seine-et-Marne|78 Yvelines|79 Deux-Sèvres|80 Somme|81 Tarn|82 Tarn-et-Garonne|83 Var|84 Vaucluse|85 Vendée|86 Vienne|87 Haute-Vienne|88 Vosges|89 Yonne|90 Territoire de Belfort|91 Essonne|92 Hauts-de-Seine|93 Seine-Saint-Denis|94 Val-de-Marne|95 Val-d'Oise|971 Guadeloupe|972 Martinique|973 Guyane|974 La Réunion|976 Mayotte")
  .split("|").map(s => [s.slice(0, s.indexOf(" ")), s.slice(s.indexOf(" ") + 1)]));
const REGIONS = { "Auvergne-Rhône-Alpes": "01 03 07 15 26 38 42 43 63 69 73 74", "Bourgogne-Franche-Comté": "21 25 39 58 70 71 89 90", "Bretagne": "22 29 35 56", "Centre-Val de Loire": "18 28 36 37 41 45", "Corse": "2A 2B", "Grand Est": "08 10 51 52 54 55 57 67 68 88", "Hauts-de-France": "02 59 60 62 80", "Île-de-France": "75 77 78 91 92 93 94 95", "Normandie": "14 27 50 61 76", "Nouvelle-Aquitaine": "16 17 19 23 24 33 40 47 64 79 86 87", "Occitanie": "09 11 12 30 31 32 34 46 48 65 66 81 82", "Pays de la Loire": "44 49 53 72 85", "Provence-Alpes-Côte d'Azur": "04 05 06 13 83 84", "Outre-mer": "971 972 973 974 976" };
const REGION_DE = {}; for (const [r, l] of Object.entries(REGIONS)) for (const d of l.split(" ")) REGION_DE[d] = r;

// Métiers : nom affiché, slug, motifs (objet + descripteurs BOAMP, sans accents), exclusions
const METIERS = [
  ["Électricité", "electricite", /electri|eclairage|courants? faibles?|bornes? de recharge|photovolta/, /diagnostic/],
  ["Génie climatique (chauffage, ventilation, climatisation)", "genie-climatique", /chauffage|climatisation|ventilation|\bcvc\b|pompes? a chaleur|chaufferie|\bvmc\b/, null],
  ["Plomberie", "plomberie", /plomberie|sanitaires? \(|robinetterie|reseaux? d'eau/, /diagnostic|amiante/],
  ["Maçonnerie et gros œuvre", "maconnerie-gros-oeuvre", /maconnerie|gros (oe|œ)uvre|demolition/, null],
  ["Menuiserie et serrurerie", "menuiserie-serrurerie", /menuiserie|fenetres?|serrurerie|metallerie/, /nettoyage des vitres/],
  ["Peinture et façade", "peinture-facade", /peinture|ravalement|facades?\b|revetements? de sols?|sols souples/, /nettoyage/],
  ["Plâtrerie et cloisons", "platrerie-cloisons", /platrerie|cloisons?|faux plafonds?|doublage/, null],
  ["Couverture et étanchéité", "couverture-etancheite", /couverture|toiture|etancheite|charpente/, /couverture (sociale|des risques|assurance)/],
  ["Terrassement et VRD", "terrassement-vrd", /terrassement|\bvrd\b|voirie|assainissement|enrobes?/, /nettoyage des voiries|balayage/],
  ["Nettoyage et propreté", "nettoyage-proprete", /nettoyage|proprete|entretien des locaux|vitrerie/, /produits|vmc|conduits/],
  ["Espaces verts", "espaces-verts", /espaces? verts?|paysag|elagage|tonte|arbres?\b/, null],
  ["Informatique et numérique", "informatique-numerique", /informatique|logiciels?|numerique|infogerance|cybersecurite|\bsaas\b/, null],
  ["Sécurité et gardiennage", "securite-gardiennage", /gardiennage|surveillance|securite incendie|videoprotection|video-?surveillance|controle d'acces/, null],
  ["Transport et déménagement", "transport-demenagement", /transports?\b|demenagement|logistique/, /transport scolaire? de denrees/],
  ["Restauration collective", "restauration-collective", /restauration|repas|traiteur|denrees|alimentaire/, /restauration (de|du|des) (batiment|facade|monument|tableau|oeuvre)/],
  ["Formation", "formation", /\bformations?\b/, /formation (de|du) (sol|terrain)/],
  ["Études, maîtrise d'œuvre et AMO", "etudes-maitrise-oeuvre", /maitrise d'(oe|œ)uvre|assistance a maitrise d'ouvrage|\bamo\b|\betudes?\b/, null],
  ["Communication et impression", "communication-impression", /communication|impression|imprimerie|signaletique|evenementiel/, null]
];

const sansAccent = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").replace(/’/g, "'");
const slug = s => sansAccent(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const arr = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
const depSlug = c => `${slug(DEPTS[c])}-${c.toLowerCase()}`;
const nomDep = c => `${DEPTS[c]} (${c})`;
const dansDep = c => { const n = DEPTS[c]; return /^(Ain|Allier|Aube|Aude|Aveyron|Eure|Indre|Isère|Oise|Orne|Yonne|Hérault|Essonne)$/.test(n) ? `dans l'${n}` : /^(Bouches|Alpes|Hautes|Côtes|Deux|Pyrénées|Hauts|Yvelines|Landes|Ardennes|Vosges)/.test(n) ? `dans les ${n}` : /^(La |Paris$|Mayotte$|Martinique$|Guadeloupe$|Guyane$)/.test(n) ? `à ${n.replace(/^La /, "La ")}` : `dans le ${n}`; };
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const jour = d => { const t = new Date(d); return isNaN(t) ? "" : `${t.getUTCDate()} ${MOIS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
const AUJ = new Date();
const phrase = s => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  const lettres = s.replace(/[^\p{L}]/gu, ""), maj = lettres.replace(/[^\p{Lu}]/gu, "").length;
  if (lettres.length && maj / lettres.length > 0.6) s = s.toLowerCase();   // intitulé saisi en majuscules
  s = s.replace(/\b[A-ZÀ-ÝŒ]{6,}\b/g, w => w.toLowerCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const joliAcheteur = s => { s = String(s || "").replace(/\s+/g, " ").trim(); if (s && s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()).replace(/\b(De|Du|Des|La|Le|Les|Et|En|Sur|Aux)\b/g, (m, w, i) => i ? w.toLowerCase() : w); return s.replace(/(\s)([DL])(['’])/g, (m, a, b, c) => a + b.toLowerCase() + c); };

async function lireOffres() {
  if (process.env.FIXTURE) return JSON.parse(fs.readFileSync(process.env.FIXTURE, "utf8"));
  const where = `nature="APPEL_OFFRE" AND datelimitereponse>=now()`;
  const url = `${BOAMP}?select=${encodeURIComponent(CHAMPS)}&where=${encodeURIComponent(where)}&order_by=${encodeURIComponent("dateparution desc")}`;
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "LumenMarches-SEO/1.0 (+https://lumen-marche.fr)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { console.error(`BOAMP, essai ${essai} : ${e.message}`); await new Promise(res => setTimeout(res, 5000 * essai)); }
  }
  throw new Error("BOAMP injoignable");
}

function normaliser(r) {
  const deps = arr(r.code_departement).map(c => /^\d$/.test(c) ? "0" + c : String(c).toUpperCase()).filter(c => DEPTS[c]);
  const texte = sansAccent([r.objet, ...arr(r.descripteur_libelle)].join(" | "));
  return {
    id: r.idweb, objet: phrase(r.objet), acheteur: joliAcheteur(r.nomacheteur), type: arr(r.type_marche)[0] || "",
    deps, parution: r.dateparution, limite: r.datelimitereponse, procedure: r.procedure_libelle || "",
    url: r.url_avis || `https://www.boamp.fr/pages/avis/?q=idweb:${r.idweb}`,
    metiers: METIERS.filter(([, , ok, non]) => ok.test(texte) && !(non && non.test(texte))).map(m => m[1])
  };
}

// ---------- Gabarit HTML ----------
function page({ chemin, titre, description, h1, chapo, corps, fil, noindex = false }) {
  const canon = `${URL_SITE}/${chemin}`;
  const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: fil.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: URL_SITE + u })) };
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(titre)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canon}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}<meta property="og:title" content="${esc(titre)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canon}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap">
<script>try{var t=localStorage.getItem("lumen-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/marches-publics/seo.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/"><i aria-hidden="true"></i>Lumen Marchés</a><nav><a href="/marches-publics/">Appels d'offres</a><a class="btn yellow small" href="/inscription.html">Essayer gratuitement</a></nav></div></header>
<main class="wrap seo">
  <nav class="fil" aria-label="Fil d'Ariane">${fil.map(([n, u], i) => i < fil.length - 1 ? `<a href="${u}">${esc(n)}</a>` : `<span>${esc(n)}</span>`).join(" <span aria-hidden=\"true\">›</span> ")}</nav>
  <h1>${esc(h1)}</h1>
  <p class="chapo">${chapo}</p>
  ${corps}
</main>
<footer class="foot"><div class="wrap"><span>Lumen IA, SIRET 985 215 474 00018 · Données publiques du BOAMP, mises à jour le ${jour(AUJ)}</span><span><a href="/mentions-legales.html">Mentions légales</a> · <a href="/cgv.html">CGV</a> · <a href="/confidentialite.html">Confidentialité</a></span></div></footer>
<script src="/config.js"></script>
<script src="/commun.js"></script>
</body>
</html>
`;
}

const carteOffre = o => {
  const j = Math.ceil((new Date(o.limite) - AUJ) / 864e5);
  return `<article class="of">
    <h3><a href="${esc(o.url)}" target="_blank" rel="noopener nofollow">${esc(o.objet)}</a></h3>
    <p class="meta"><span>${esc(o.acheteur || "Acheteur public")}</span>${o.deps.length ? `<span>${esc(o.deps.slice(0, 3).map(nomDep).join(", "))}</span>` : ""}${o.type ? `<span>${esc(o.type.charAt(0) + o.type.slice(1).toLowerCase())}</span>` : ""}</p>
    <p class="lim"><span class="reste">${j <= 30 ? `Plus que ${j} jour${j > 1 ? "s" : ""}` : "Date limite"}</span> ${esc(jour(o.limite))}</p>
  </article>`;
};
const cta = (texte, lien) => `<aside class="cta-seo"><div><b>${texte}</b><span>14 jours d'essai gratuits, sans carte bancaire. Puis 49 € HT par mois, sans engagement.</span></div><a class="btn yellow" href="${lien}">Recevoir ces offres chaque matin</a></aside>`;
const compteParType = os => { const c = {}; for (const o of os) { const t = (o.type || "autre").toLowerCase(); c[t] = (c[t] || 0) + 1; } const L = { travaux: "travaux", services: "services", fournitures: "fournitures" }; return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${L[t] ? "en " + L[t] : t}`).join(", "); };
const principauxAcheteurs = os => { const c = {}; for (const o of os) if (o.acheteur) c[o.acheteur] = (c[o.acheteur] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a]) => a); };

async function main() {
  const brut = await lireOffres();
  const offres = brut.map(normaliser).filter(o => o.objet && o.deps.length && new Date(o.limite) > AUJ);
  console.log(`${brut.length} avis lus, ${offres.length} consultations ouvertes exploitables`);
  if (offres.length < 50 && !process.env.FIXTURE) throw new Error("Trop peu d'offres : arrêt pour ne pas vider le site");

  fs.rmSync(SORTIE, { recursive: true, force: true });
  fs.mkdirSync(SORTIE, { recursive: true });
  fs.copyFileSync(path.join(RACINE, "seo", "seo.css"), path.join(SORTIE, "seo.css"));
  const urls = [];
  const ecrire = (chemin, html) => { const f = path.join(SITE, chemin, "index.html"); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); urls.push(chemin); };

  const parMetierDep = {}, parMetier = {}, parDep = {};
  for (const o of offres) for (const m of o.metiers) {
    (parMetier[m] ||= []).push(o);
    for (const d of o.deps) { ((parMetierDep[m] ||= {})[d] ||= []).push(o); ((parDep[d] ||= {})[m] ||= []).push(o); }
  }
  const tri = os => [...os].sort((a, b) => new Date(a.limite) - new Date(b.limite));
  const metierDe = s => METIERS.find(m => m[1] === s);

  // 1. Pages métier × département
  for (const [m, deps] of Object.entries(parMetierDep)) {
    const [nom] = metierDe(m);
    for (const [d, os] of Object.entries(deps)) {
      const liste = tri(os), n = liste.length;
      const ach = principauxAcheteurs(liste);
      const prochaine = liste[0];
      const voisins = (REGIONS[REGION_DE[d]] || "").split(" ").filter(x => x && x !== d && parMetierDep[m]?.[x]);
      const autres = Object.entries(parDep[d] || {}).filter(([mm]) => mm !== m).sort((a, b) => b[1].length - a[1].length);
      const chemin = `marches-publics/${m}/${depSlug(d)}/`;
      const nomCourt = nom.split(" (")[0];
      ecrire(chemin, page({
        chemin, noindex: n < 2,
        titre: `Appels d'offres ${nomCourt.toLowerCase()} ${dansDep(d).replace(/^(dans |à )(l'|le |la |les )?/, "")} (${d}) : ${n} marché${n > 1 ? "s" : ""} public${n > 1 ? "s" : ""} ouvert${n > 1 ? "s" : ""}`,
        description: `${n} consultation${n > 1 ? "s" : ""} publique${n > 1 ? "s" : ""} ${nomCourt.toLowerCase()} ouverte${n > 1 ? "s" : ""} ${dansDep(d)} au ${jour(AUJ)}${ach.length ? `, dont ${ach.slice(0, 2).join(", ")}` : ""}. Recevez-les chaque matin avec Lumen Marchés.`,
        h1: `Appels d'offres ${nomCourt.toLowerCase()} ${dansDep(d)} (${d})`,
        chapo: `<b>${n} consultation${n > 1 ? "s" : ""} ouverte${n > 1 ? "s" : ""}</b> au ${jour(AUJ)} (${compteParType(liste)}). Prochaine date limite : ${esc(jour(prochaine.limite))}.${ach.length ? ` Principaux acheteurs : ${esc(ach.join(", "))}.` : ""}`,
        fil: [["Accueil", "/"], ["Appels d'offres", "/marches-publics/"], [nomCourt, `/marches-publics/${m}/`], [DEPTS[d], "/" + chemin]],
        corps: `${cta(`Vous travaillez en ${nomCourt.toLowerCase()} ${dansDep(d)} ?`, `/inscription.html?deps=${d}&metier=${m}`)}
  <section class="liste">${liste.slice(0, 60).map(carteOffre).join("\n")}</section>
  ${n > 60 ? `<p class="muted">Et ${n - 60} autres consultations : <a href="/inscription.html?deps=${d}&metier=${m}">recevez-les toutes avec Lumen</a>.</p>` : ""}
  <section class="explique"><h2>Comment ne manquer aucun marché ${nomCourt.toLowerCase()} ${dansDep(d)} ?</h2>
    <p>Les acheteurs publics (communes, départements, hôpitaux, bailleurs sociaux, établissements scolaires) publient leurs consultations sur le BOAMP et sur leurs propres plateformes. Lumen Marchés les lit chaque matin, garde celles qui correspondent à votre métier et à votre zone, et vous les envoie résumées par email, avec la date limite et le lien vers le dossier.</p></section>
  ${voisins.length ? `<section class="liens"><h2>${esc(nomCourt)} : départements voisins</h2><p>${voisins.map(x => `<a href="/marches-publics/${m}/${depSlug(x)}/">${esc(nomDep(x))} (${parMetierDep[m][x].length})</a>`).join("")}</p></section>` : ""}
  ${autres.length ? `<section class="liens"><h2>Autres métiers ${dansDep(d)}</h2><p>${autres.slice(0, 12).map(([mm, oo]) => `<a href="/marches-publics/${mm}/${depSlug(d)}/">${esc(metierDe(mm)[0].split(" (")[0])} (${oo.length})</a>`).join("")}</p></section>` : ""}`
      }));
    }
  }

  // 2. Pages métier (France entière)
  for (const [m, os] of Object.entries(parMetier)) {
    const [nom] = metierDe(m), nomCourt = nom.split(" (")[0];
    const deps = Object.entries(parMetierDep[m]).sort((a, b) => b[1].length - a[1].length);
    const chemin = `marches-publics/${m}/`;
    ecrire(chemin, page({
      chemin,
      titre: `Appels d'offres ${nomCourt.toLowerCase()} : ${os.length} marchés publics ouverts en France`,
      description: `${os.length} consultations publiques ${nomCourt.toLowerCase()} ouvertes au ${jour(AUJ)}, par département. Recevez chaque matin celles de votre zone avec Lumen Marchés.`,
      h1: `Appels d'offres ${nomCourt.toLowerCase()}`,
      chapo: `<b>${os.length} consultations ouvertes en France</b> au ${jour(AUJ)}, réparties dans ${deps.length} départements. Choisissez votre département pour voir les offres.`,
      fil: [["Accueil", "/"], ["Appels d'offres", "/marches-publics/"], [nomCourt, "/" + chemin]],
      corps: `<section class="grille-deps">${Object.entries(REGIONS).map(([r, l]) => { const ds = l.split(" ").filter(d => parMetierDep[m][d]); return ds.length ? `<div><h2>${esc(r)}</h2>${ds.map(d => `<a href="/marches-publics/${m}/${depSlug(d)}/">${esc(nomDep(d))} <span>${parMetierDep[m][d].length}</span></a>`).join("")}</div>` : ""; }).join("")}</section>
  ${cta(`Recevez les appels d'offres ${nomCourt.toLowerCase()} de votre zone`, `/inscription.html?metier=${m}`)}
  <section class="liste"><h2>Les plus récents</h2>${[...os].sort((a, b) => String(b.parution).localeCompare(String(a.parution))).slice(0, 15).map(carteOffre).join("\n")}</section>`
    }));
  }

  // 3. Pages département (tous métiers)
  for (const [d, ms] of Object.entries(parDep)) {
    const chemin = `marches-publics/departement/${depSlug(d)}/`;
    const total = new Set(Object.values(ms).flat().map(o => o.id)).size;
    ecrire(chemin, page({
      chemin,
      titre: `Appels d'offres ${dansDep(d).replace(/^(dans |à )(l'|le |la |les )?/, "")} (${d}) : marchés publics ouverts par métier`,
      description: `${total} consultations publiques ouvertes ${dansDep(d)} au ${jour(AUJ)}, classées par métier : nettoyage, travaux, informatique, espaces verts… Avec Lumen Marchés.`,
      h1: `Appels d'offres ${dansDep(d)} (${d})`,
      chapo: `<b>${total} consultations ouvertes</b> au ${jour(AUJ)}, classées par métier.`,
      fil: [["Accueil", "/"], ["Appels d'offres", "/marches-publics/"], [DEPTS[d], "/" + chemin]],
      corps: `<section class="grille-metiers">${Object.entries(ms).sort((a, b) => b[1].length - a[1].length).map(([m, os]) => `<a href="/marches-publics/${m}/${depSlug(d)}/">${esc(metierDe(m)[0])} <span>${os.length}</span></a>`).join("")}</section>
  ${cta(`Recevez les appels d'offres ${dansDep(d)} qui correspondent à votre métier`, `/inscription.html?deps=${d}`)}`
    }));
  }

  // 4. Page d'accueil des appels d'offres
  ecrire("marches-publics/", page({
    chemin: "marches-publics/",
    titre: `Appels d'offres et marchés publics ouverts par métier et par département`,
    description: `${offres.length} consultations publiques ouvertes au ${jour(AUJ)}, classées par métier et par département. Mises à jour chaque jour à partir du BOAMP.`,
    h1: "Appels d'offres publics ouverts",
    chapo: `<b>${offres.length} consultations ouvertes</b> au ${jour(AUJ)}, mises à jour chaque matin à partir du BOAMP.`,
    fil: [["Accueil", "/"], ["Appels d'offres", "/marches-publics/"]],
    corps: `<h2 class="sous">Par métier</h2><section class="grille-metiers">${METIERS.filter(m => parMetier[m[1]]).map(([nom, m]) => `<a href="/marches-publics/${m}/">${esc(nom)} <span>${parMetier[m].length}</span></a>`).join("")}</section>
  <h2 class="sous">Par département</h2><section class="grille-deps">${Object.entries(REGIONS).map(([r, l]) => { const ds = l.split(" ").filter(d => parDep[d]); return ds.length ? `<div><h2>${esc(r)}</h2>${ds.map(d => `<a href="/marches-publics/departement/${depSlug(d)}/">${esc(nomDep(d))}</a>`).join("")}</div>` : ""; }).join("")}</section>
  ${cta("Recevez chaque matin les appels d'offres de votre métier et de votre zone", "/inscription.html")}`
  }));

  // 5. Plan du site
  const fixes = ["", "inscription.html", "sur-mesure.html", "cgv.html", "mentions-legales.html", "confidentialite.html"];
  const aIndexer = urls.filter(u => !fs.readFileSync(path.join(SITE, u, "index.html"), "utf8").includes('content="noindex'));
  const date = AUJ.toISOString().slice(0, 10);
  fs.writeFileSync(path.join(SITE, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...fixes.map(u => `  <url><loc>${URL_SITE}/${u}</loc></url>`), ...aIndexer.map(u => `  <url><loc>${URL_SITE}/${u}</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq></url>`)].join("\n")}
</urlset>
`);
  console.log(`${urls.length} pages écrites (${aIndexer.length} dans le plan du site)`);
}

main().catch(e => { console.error(e); process.exit(1); });
