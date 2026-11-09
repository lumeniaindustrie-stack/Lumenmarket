/* Fonctions partagées par les pages du site Lumen Marchés */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CFG = window.CONFIG || {};

/* ---------- Stockage local (session et offres suivies) ---------- */
const local = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- Comptes clients (Supabase) ---------- */
const SB = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
const DEMO = !SB && !!CFG.DEMO;   // mode démonstration : comptes simulés dans ce navigateur
const COMPTES_PRETS = !!SB || DEMO;

const MSG_ERREURS = [
  [/already registered|already been registered|already exists/i, "Un compte existe déjà avec cet email. Connectez-vous, ou utilisez « Mot de passe oublié »."],
  [/invalid login credentials/i, "Email ou mot de passe incorrect."],
  [/email not confirmed/i, "Votre adresse email n'est pas encore confirmée. Cliquez sur le lien reçu par email, puis reconnectez-vous."],
  [/password should be at least|weak password|password is too weak/i, "Mot de passe trop faible : au moins 10 caractères, avec des lettres et des chiffres."],
  [/rate limit|too many|security purposes/i, "Trop de tentatives. Patientez une minute puis réessayez."],
  [/same.*password|different from the old/i, "Le nouveau mot de passe doit être différent de l'ancien."],
  [/error sending (confirmation|recovery|magic)|sending.*email|smtp/i, "L'email de confirmation n'a pas pu être envoyé (problème d'envoi d'emails). Réessayez dans quelques minutes, ou écrivez-nous."],
  [/database error saving new user|database error/i, "Le compte n'a pas pu être enregistré dans la base. Écrivez-nous, nous réglons cela rapidement."],
  [/signups not allowed|signup.*disabled/i, "Les inscriptions sont momentanément fermées."],
  [/email address .* is invalid|invalid email/i, "Cette adresse email n'est pas acceptée. Vérifiez-la ou utilisez une autre adresse."],
  [/failed to fetch|network/i, "Connexion impossible. Vérifiez votre accès à internet puis réessayez."]
];
const traduireErreur = e => { const m = String(e?.message || e || ""); const t = MSG_ERREURS.find(([r]) => r.test(m)); if (m) console.warn("Lumen, détail de l'erreur :", m); return t ? t[1] : "Une erreur est survenue. Réessayez dans un instant." + (m ? " (détail : " + m.slice(0, 120) + ")" : ""); };
const verifierMdp = p => p.length < 10 ? "Le mot de passe doit faire au moins 10 caractères."
  : !/[a-zA-Z]/.test(p) || !/\d/.test(p) ? "Le mot de passe doit contenir des lettres et des chiffres." : null;

/* Mode démonstration : tout est simulé dans le navigateur (aucune donnée réelle) */
const Demo = {
  get: () => local.get("lumen_demo"), set: v => local.set("lumen_demo", v),
  nouveau(email, meta) {
    const ex = EXEMPLES.map((o, i) => ({ avis_id: o.id, objet: o.objet, acheteur: o.acheteur, departement: o.dep, lieu: o.lieu, montant: o.montant, limite: o.limite, score: 5 - (i % 3), resume: o.resume, url: o.url, date_envoi: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10) }));
    return { email, profil: { id: "demo", email, formule: "essai", actif: true, fin_essai: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), types: "TRAVAUX, SERVICES, FOURNITURES", ...meta }, marches: ex, analyses: [], suivies: [] };
  }
};

const Compte = {
  async session() {
    if (SB) { const { data } = await SB.auth.getSession(); return data.session; }
    return DEMO && Demo.get()?.connecte ? { demo: true, user: { email: Demo.get().email } } : null;
  },
  async inscrire(email, password, meta) {
    if (DEMO) { Demo.set({ ...Demo.nouveau(email, meta), connecte: true }); return { confirmer: false }; }
    const { data, error } = await SB.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: new URL("tableau.html", location.href).href } });
    if (error) throw error;
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("already registered");
    return { confirmer: !data.session };
  },
  async connecter(email, password) {
    if (DEMO) { const d = Demo.get() || Demo.nouveau(email, { entreprise: "Entreprise de démonstration", metiers: "électricité, génie climatique", departements: "13, 83, 84", mots_cles: "éclairage, chauffage, climatisation" }); Demo.set({ ...d, email, connecte: true }); return; }
    const { error } = await SB.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async deconnecter() { if (SB) await SB.auth.signOut(); else if (DEMO) Demo.set({ ...Demo.get(), connecte: false }); },
  async motDePasseOublie(email) {
    if (DEMO) return;
    const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: new URL("nouveau-mdp.html", location.href).href });
    if (error) throw error;
  },
  async changerMotDePasse(password) {
    if (DEMO) return;
    const { error } = await SB.auth.updateUser({ password });
    if (error) throw error;
  },
  async charger() {
    if (DEMO) { const d = Demo.get(); return { profil: d.profil, marches: d.marches, analyses: d.analyses, suivies: d.suivies }; }
    const [p, m, a, s] = await Promise.all([
      SB.from("profils").select("*").single(),
      SB.from("offres_envoyees").select("*").order("date_envoi", { ascending: false }).limit(200),
      SB.from("analyses").select("id,cree_le,objet,decision,statut,resultat,message").order("cree_le", { ascending: false }).limit(50),
      SB.from("offres_suivies").select("*")
    ]);
    if (p.error) throw p.error;
    return { profil: p.data, marches: m.data || [], analyses: a.data || [], suivies: (s.data || []).map(x => x.donnees) };
  },
  async majProfil(champs) {
    if (DEMO) { const d = Demo.get(); d.profil = { ...d.profil, ...champs }; Demo.set(d); return d.profil; }
    const { data: { session } } = await SB.auth.getSession();
    const { data, error } = await SB.from("profils").update(champs).eq("id", session.user.id).select().single();
    if (error) throw error;
    return data;
  },
  async suivre(o) {
    if (DEMO) { const d = Demo.get(); d.suivies = [...d.suivies.filter(x => x.id !== o.id), o]; Demo.set(d); return; }
    const { error } = await SB.from("offres_suivies").insert({ avis_id: String(o.id), donnees: o });
    if (error) throw error;
  },
  async nePlusSuivre(id) {
    if (DEMO) { const d = Demo.get(); d.suivies = d.suivies.filter(x => x.id !== id); Demo.set(d); return; }
    const { error } = await SB.from("offres_suivies").delete().eq("avis_id", String(id));
    if (error) throw error;
  },
  async jeton() { if (!SB) return "demo"; const { data } = await SB.auth.getSession(); return data.session?.access_token; },
  // Indique vite (sans réseau) si quelqu'un semble connecté sur ce navigateur
  semblerConnecte() { try { return Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)) || !!local.get("lumen_demo")?.connecte; } catch (e) { return false; } }
};

/* Mots-clés ajoutés automatiquement selon l'activité choisie */
const MOTS_ACTIVITE = {
  "électricité": "électri, éclairage, courant faible, borne de recharge",
  "génie climatique": "chauffage, climatisation, ventilation, CVC, pompe à chaleur, chaufferie",
  "plomberie": "plomberie, sanitaire, réseau d'eau",
  "maçonnerie": "maçonnerie, gros œuvre, gros oeuvre, réhabilitation, démolition",
  "menuiserie": "menuiserie, fenêtre, porte, serrurerie, métallerie",
  "peinture": "peinture, revêtement, ravalement, façade",
  "plâtrerie": "plâtrerie, cloison, faux plafond, doublage",
  "couverture": "couverture, toiture, étanchéité, charpente",
  "terrassement": "terrassement, VRD, voirie, assainissement, réseaux",
  "nettoyage": "nettoyage, propreté, entretien des locaux, vitrerie",
  "espaces verts": "espaces verts, paysager, élagage, tonte, arbres",
  "informatique": "informatique, logiciel, numérique, infogérance, matériel informatique",
  "sécurité": "gardiennage, surveillance, sécurité incendie, vidéoprotection, contrôle d'accès",
  "transport": "transport, déménagement, logistique, livraison, véhicule",
  "restauration": "restauration, repas, traiteur, denrées, alimentaire",
  "formation": "formation, accompagnement",
  "études": "études, conseil, assistance à maîtrise d'ouvrage, AMO, audit, maîtrise d'œuvre, diagnostic",
  "fournitures": "fournitures, mobilier, équipement, matériel",
  "communication": "communication, impression, imprimerie, signalétique, événementiel"
};
const motsAuto = metiers => { const m = String(metiers || "").toLowerCase(); return Object.entries(MOTS_ACTIVITE).filter(([k]) => m.includes(k)).map(([, v]) => v).join(", "); };

/* ---------- Départements ---------- */
const DEPTS = Object.fromEntries("01 Ain|02 Aisne|03 Allier|04 Alpes-de-Haute-Provence|05 Hautes-Alpes|06 Alpes-Maritimes|07 Ardèche|08 Ardennes|09 Ariège|10 Aube|11 Aude|12 Aveyron|13 Bouches-du-Rhône|14 Calvados|15 Cantal|16 Charente|17 Charente-Maritime|18 Cher|19 Corrèze|2A Corse-du-Sud|2B Haute-Corse|21 Côte-d'Or|22 Côtes-d'Armor|23 Creuse|24 Dordogne|25 Doubs|26 Drôme|27 Eure|28 Eure-et-Loir|29 Finistère|30 Gard|31 Haute-Garonne|32 Gers|33 Gironde|34 Hérault|35 Ille-et-Vilaine|36 Indre|37 Indre-et-Loire|38 Isère|39 Jura|40 Landes|41 Loir-et-Cher|42 Loire|43 Haute-Loire|44 Loire-Atlantique|45 Loiret|46 Lot|47 Lot-et-Garonne|48 Lozère|49 Maine-et-Loire|50 Manche|51 Marne|52 Haute-Marne|53 Mayenne|54 Meurthe-et-Moselle|55 Meuse|56 Morbihan|57 Moselle|58 Nièvre|59 Nord|60 Oise|61 Orne|62 Pas-de-Calais|63 Puy-de-Dôme|64 Pyrénées-Atlantiques|65 Hautes-Pyrénées|66 Pyrénées-Orientales|67 Bas-Rhin|68 Haut-Rhin|69 Rhône|70 Haute-Saône|71 Saône-et-Loire|72 Sarthe|73 Savoie|74 Haute-Savoie|75 Paris|76 Seine-Maritime|77 Seine-et-Marne|78 Yvelines|79 Deux-Sèvres|80 Somme|81 Tarn|82 Tarn-et-Garonne|83 Var|84 Vaucluse|85 Vendée|86 Vienne|87 Haute-Vienne|88 Vosges|89 Yonne|90 Territoire de Belfort|91 Essonne|92 Hauts-de-Seine|93 Seine-Saint-Denis|94 Val-de-Marne|95 Val-d'Oise|971 Guadeloupe|972 Martinique|973 Guyane|974 La Réunion|976 Mayotte"
  .split("|").map(s => [s.slice(0, s.indexOf(" ")), s.slice(s.indexOf(" ") + 1)]));
const nomDep = c => DEPTS[c] ? `${DEPTS[c]} (${c})` : (c ? "Dép. " + c : "");
const parseDeps = s => String(s || "").split(/[,;\s]+/).map(d => d.trim().toUpperCase()).filter(Boolean).map(d => /^\d$/.test(d) ? "0" + d : d);

/* ---------- Mise en forme ---------- */
const toDate = d => { if (!d) return null; const t = new Date(d); return isNaN(t) ? null : t; };
const fmtJour = d => { const t = toDate(d); return t ? t.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : (d || ""); };
const fmtJourCourt = d => { const t = toDate(d); return t ? t.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""; };
// Le BOAMP donne l'heure de Paris marquée « +00:00 » : on l'affiche telle quelle (fuseau UTC).
const fmtLimite = d => { const t = toDate(d); if (!t) return "Date limite non précisée"; const s = t.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); return s.replace(" à ", ", "); };
const joursRestants = d => { const t = toDate(d); return t ? Math.ceil((t - new Date()) / 86400000) : null; };
const fmtReste = d => { const j = joursRestants(d); if (j == null) return ""; if (j < 0) return "Clôturé"; if (j === 0) return "Aujourd'hui"; if (j === 1) return "Demain"; return `J-${j}`; };
const fmtMontant = n => {
  if (n == null || !isFinite(n) || n <= 1) return null;
  if (n >= 1e6) return "≈ " + (n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M€ HT";
  if (n >= 1e3) return "≈ " + Math.round(n / 1e3).toLocaleString("fr-FR") + " k€ HT";
  return "≈ " + Math.round(n).toLocaleString("fr-FR") + " € HT";
};

/* ---------- BOAMP (lecture directe des offres publiques) ---------- */
const BOAMP_URL = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const arr = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
function lireDonnees(r) { try { return typeof r.donnees === "string" ? JSON.parse(r.donnees) : (r.donnees || {}); } catch (e) { return {}; } }
function chercher(o, test, out = []) { if (o && typeof o === "object") for (const k in o) { if (test(k, o[k])) out.push(o[k]); chercher(o[k], test, out); } return out; }
function montantDe(d) {
  const num = v => { const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) && n > 1 ? n : null; };
  const vals = chercher(d, (k, v) => /^valeur$/i.test(k) && typeof v !== "object").map(num).filter(Boolean);
  const hautes = chercher(d, (k, v) => /^valeurHaute$/i.test(k) && typeof v !== "object").map(num).filter(Boolean);
  const lots = chercher(d, (k, v) => /^estimationValeur$/i.test(k) && v && typeof v === "object").map(x => num(x.valeur)).filter(Boolean);
  if (lots.length > 1) return lots.reduce((a, b) => a + b, 0);
  return vals[0] || hautes[0] || lots[0] || null;
}
const nettoyerLieu = l => String(l).replace(/\s+/g, " ").replace(/^FR[A-Z0-9]*\s*-\s*/i, "").replace(/,\s*-\s*/g, ", ").replace(/^[\s,-]+|[\s,-]+$/g, "").slice(0, 60);
function normaliser(r) {
  const d = lireDonnees(r);
  const lieu = chercher(d, (k, v) => /^lieuExecution$/i.test(k) && typeof v === "string")[0]
    || chercher(d, (k, v) => /^ville$/i.test(k) && typeof v === "string")[0] || "";
  const duree = chercher(d, (k, v) => /^dureeMois$/i.test(k) && typeof v !== "object")[0];
  const nbLots = chercher(d, (k, v) => /^lot$/i.test(k) && Array.isArray(v))[0]?.length || 0;
  const type = arr(r.type_marche_facette)[0] || arr(r.type_marche)[0] || "";
  const domaines = arr(r.descripteur_libelle).slice(0, 3);
  const deps = arr(r.code_departement).map(c => /^\d$/.test(c) ? "0" + c : String(c));
  const montant = montantDe(d);
  let resume = type ? `Marché de ${type.toLowerCase()}` : "Marché public";
  if (nbLots > 1) resume += ` en ${nbLots} lots`;
  if (duree) resume += `, durée ${duree} mois`;
  resume += ".";
  if (domaines.length) resume += " Domaines : " + domaines.join(", ").toLowerCase() + ".";
  const villeOk = lieu && !/^\d+$/.test(lieu);
  return {
    id: r.idweb || r.id, objet: (r.objet || "").trim(), acheteur: r.nomacheteur || "", type, deps,
    lieu: villeOk ? nettoyerLieu(lieu) || nomDep(deps[0]) : nomDep(deps[0]),
    dep: deps[0] || "", parution: r.dateparution, limite: r.datelimitereponse, procedure: r.procedure_libelle || "",
    montant, montantTxt: fmtMontant(montant) || "Montant non communiqué", resume,
    url: r.url_avis || ("https://www.boamp.fr/pages/avis/?q=idweb:" + (r.idweb || ""))
  };
}
async function chercherOffres({ q = "", deps = [], types = [], ouvertes = true, depuis = 0, limit = 40 } = {}) {
  const w = [`nature="APPEL_OFFRE"`];
  if (ouvertes) w.push(`datelimitereponse>=now()`);
  if (depuis) w.push(`dateparution>=date'${new Date(Date.now() - depuis * 86400000).toISOString().slice(0, 10)}'`);
  if (deps.length) {
    const codes = [...new Set(deps.flatMap(d => { d = String(d).replace(/"/g, ""); return /^0\d$/.test(d) ? [d, d.slice(1)] : [d]; }))];
    w.push("(" + codes.map(d => `code_departement="${d}"`).join(" OR ") + ")");
  }
  if (types.length) w.push("(" + types.map(t => `type_marche="${t}"`).join(" OR ") + ")");
  const mots = String(q).trim();
  if (mots) w.push("(" + mots.split(/\s*,\s*/).filter(Boolean).slice(0, 8).map(m => `search(objet, "${m.replace(/"/g, "")}")`).join(" OR ") + ")");
  const url = `${BOAMP_URL}?limit=${limit}&order_by=dateparution%20desc&where=${encodeURIComponent(w.join(" AND "))}`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.message || "BOAMP indisponible");
    return { total: j.total_count || 0, offres: (j.results || []).map(normaliser).filter(o => o.objet) };
  } finally { clearTimeout(timer); }
}

/* ---------- Agenda (.ics) ---------- */
function telechargerIcs(o) {
  const t = toDate(o.limite); if (!t) return;
  const f = x => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fin = new Date(t.getTime() + 30 * 60000);
  const loc = x => x.toISOString().slice(0, 19).replace(/[-:]/g, ""); // heure de Paris (voir fmtLimite)
  const txt = s => String(s || "").replace(/[,;\\]/g, m => "\\" + m).replace(/\n/g, " ");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lumen Marchés//FR", "BEGIN:VEVENT",
    `UID:${o.id}@lumen-marches`, `DTSTAMP:${f(new Date())}`, `DTSTART;TZID=Europe/Paris:${loc(t)}`, `DTEND;TZID=Europe/Paris:${loc(fin)}`,
    `SUMMARY:${txt("Date limite : " + o.objet)}`, `DESCRIPTION:${txt(o.acheteur + " " + o.url)}`, `URL:${o.url}`,
    "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", `DESCRIPTION:${txt("Date limite dans 2 jours")}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "date-limite-" + o.id + ".ics"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Exemples (si le BOAMP ne répond pas) ---------- */
const dans = j => { const d = new Date(Date.now() + j * 864e5); d.setHours(12, 0, 0, 0); return d.toISOString(); };
const EXEMPLES = [
  { id: "ex1", objet: "Rénovation de l'éclairage public, quartier des Aubes", acheteur: "Commune (exemple)", lieu: "Bouches-du-Rhône (13)", dep: "13", type: "Travaux", resume: "Marché de travaux, durée 6 mois. Domaines : éclairage public, électricité.", montant: 180000, limite: dans(22), url: "https://www.boamp.fr" },
  { id: "ex2", objet: "Nettoyage des locaux et de la vitrerie des bâtiments communaux", acheteur: "Commune (exemple)", lieu: "Var (83)", dep: "83", type: "Services", resume: "Marché de services en 3 lots, durée 36 mois. Domaines : nettoyage.", montant: null, limite: dans(18), url: "https://www.boamp.fr" },
  { id: "ex3", objet: "Remplacement de la production de chaleur d'un collège", acheteur: "Département (exemple)", lieu: "Vaucluse (84)", dep: "84", type: "Travaux", resume: "Marché de travaux, durée 8 mois. Domaines : chauffage, ventilation.", montant: 420000, limite: dans(27), url: "https://www.boamp.fr" },
  { id: "ex4", objet: "Maintenance du parc informatique et des copieurs", acheteur: "Communauté d'agglomération (exemple)", lieu: "Alpes-Maritimes (06)", dep: "06", type: "Services", resume: "Marché de services, durée 48 mois. Domaines : informatique, maintenance.", montant: 95000, limite: dans(15), url: "https://www.boamp.fr" },
  { id: "ex5", objet: "Installation de panneaux photovoltaïques sur trois écoles", acheteur: "Commune (exemple)", lieu: "Bouches-du-Rhône (13)", dep: "13", type: "Travaux", resume: "Marché de travaux en 3 lots, durée 10 mois. Domaines : énergie solaire.", montant: 650000, limite: dans(30), url: "https://www.boamp.fr" },
  { id: "ex6", objet: "Entretien des espaces verts et élagage", acheteur: "Syndicat intercommunal (exemple)", lieu: "Alpes-de-Haute-Provence (04)", dep: "04", type: "Services", resume: "Marché de services, durée 24 mois. Domaines : espaces verts.", montant: null, limite: dans(12), url: "https://www.boamp.fr" }
].map(o => ({ ...o, montantTxt: fmtMontant(o.montant) || "Montant non communiqué", exemple: true }));

/* ---------- Appels aux agents n8n ---------- */
async function appelerAgent(url, data) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error("agent");
  return j;
}

/* ---------- Barre de montant minimum ---------- */
const PALIERS_MONTANT = [0, 10000, 20000, 40000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 750000, 1000000];
const libelleMontant = v => !v ? "Pas de minimum" : v >= 1e6 ? "1 M€ et plus" : "À partir de " + v.toLocaleString("fr-FR") + " € HT";
function brancherCurseur(curseurId, champId, sortieId) {
  const r = $("#" + curseurId), h = $("#" + champId), out = $("#" + sortieId);
  r.min = 0; r.max = PALIERS_MONTANT.length - 1; r.step = 1;
  const maj = () => { const v = PALIERS_MONTANT[+r.value]; h.value = v ? String(v) : ""; out.textContent = libelleMontant(v); r.style.setProperty("--p", (r.value / r.max * 100) + "%"); r.setAttribute("aria-valuetext", libelleMontant(v)); };
  r.addEventListener("input", maj);
  // Positionne la barre à partir d'une valeur (ex. profil chargé)
  h.regler = v => { v = Number(v) || 0; let i = 0; PALIERS_MONTANT.forEach((p, k) => { if (Math.abs(p - v) < Math.abs(PALIERS_MONTANT[i] - v)) i = k; }); r.value = i; maj(); };
  h.regler(h.value);
}

/* ---------- Fiche entreprise (annuaire public des entreprises) ---------- */
const EFFECTIFS_INSEE = { "00": "0 salarié", "01": "1 ou 2 salariés", "02": "3 à 5 salariés", "03": "6 à 9 salariés", "11": "10 à 19 salariés", "12": "20 à 49 salariés", "21": "50 à 99 salariés", "22": "100 à 199 salariés", "31": "200 à 249 salariés", "32": "250 à 499 salariés", "41": "500 à 999 salariés", "42": "1 000 à 1 999 salariés", "51": "2 000 à 4 999 salariés", "52": "5 000 à 9 999 salariés", "53": "10 000 salariés et plus" };
const TRANCHES_EFFECTIF = ["0 à 2", "3 à 9", "10 à 19", "20 à 49", "50 à 249", "250 et plus"];
const TRANCHES_CA = ["Moins de 500 k€", "500 k€ à 1 M€", "1 à 2 M€", "2 à 5 M€", "5 à 10 M€", "Plus de 10 M€"];
const trancheEffectif = code => ({ "00": 0, "01": 0, "02": 1, "03": 1, "11": 2, "12": 3, "21": 4, "22": 4, "31": 4 }[code] ?? (code && code !== "NN" ? 5 : null));
const trancheCA = ca => ca == null ? null : ca < 5e5 ? 0 : ca < 1e6 ? 1 : ca < 2e6 ? 2 : ca < 5e6 ? 3 : ca < 1e7 ? 4 : 5;
async function chercherEntreprise(numero) {
  const n = String(numero).replace(/\s/g, "");
  if (!/^\d{9}(\d{5})?$/.test(n)) throw new Error("format");
  const j = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${n}&per_page=1`).then(r => r.json());
  const r = j.results?.[0];
  if (!r || r.siren !== n.slice(0, 9)) return null;
  const etab = (r.matching_etablissements || []).find(e => e.siret === n) || r.siege || {};
  const annees = Object.keys(r.finances || {}).sort(); const ca = annees.length ? r.finances[annees.at(-1)]?.ca : null;
  const lab = [];
  if (r.complements?.est_rge) lab.push("RGE");
  if (r.complements?.est_qualiopi) lab.push("Qualiopi");
  const nd = v => v && !/NON-DIFFUSIBLE/i.test(v) ? v : "";
  return {
    siren: r.siren, siret: n.length === 14 ? n : (r.siege?.siret || ""), nom: nd(r.nom_complet), ville: nd(etab.libelle_commune || r.siege?.libelle_commune),
    code_postal: nd(etab.code_postal || r.siege?.code_postal), naf: r.activite_principale || "", effectif_code: r.tranche_effectif_salarie,
    effectif_txt: EFFECTIFS_INSEE[r.tranche_effectif_salarie] || "", ca, ca_annee: annees.at(-1) || "", labels: lab,
    creation: r.date_creation || "", actif: r.etat_administratif === "A"
  };
}

/* ---------- Marchés publics remportés (données essentielles de la commande publique) ---------- */
async function marchesGagnes(siren) {
  siren = String(siren).slice(0, 9);
  if (!/^\d{9}$/.test(siren)) return [];
  const w = [`siretetablissement like "${siren}*"`, ...[1, 2, 3].map(i => `id_cotitulaire${i} like "${siren}*"`)].join(" OR ");
  const url = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp_augmente/records?limit=80&order_by=datenotification%20desc&select=objetmarche,nomacheteur,montant,datenotification,lieuexecutionnom&where=" + encodeURIComponent(w);
  const j = await fetch(url).then(r => r.json());
  if (j.error_code) throw new Error(j.message || "decp");
  const vus = new Set(), out = [];
  for (const m of j.results || []) {
    const k = [m.objetmarche, m.datenotification, Math.round(m.montant || 0)].join("|"); if (vus.has(k)) continue; vus.add(k);
    out.push({ date: m.datenotification || "", objet: String(m.objetmarche || "").trim(), acheteur: m.nomacheteur || "", montant: m.montant || null, lieu: String(m.lieuexecutionnom || "").replace(/^\(\w+\)\s*/, "") });
  }
  return out;
}
const resumeMarches = l => l.slice(0, 25).map(m => `${(m.date || "").slice(0, 7)} ${m.objet.slice(0, 110)}${m.acheteur ? " (" + m.acheteur.slice(0, 50) + ")" : ""}${m.montant ? ", " + Math.round(m.montant / 1000) + " k€" : ""}`).join("\n").slice(0, 3900);
