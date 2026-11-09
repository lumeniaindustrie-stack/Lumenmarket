"""Génère les agents n8n locaux : A (collecteur BOAMP) et B (tri par client avec Ollama)."""
import json, os

OUT = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = "https://jsmffmtzoauvqltshiyg.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_kDVV8tAZEirvMiVXpr4YPw_hmAdT7Mu"  # clé publique : sécurité assurée par les règles RLS
SB_CRED = {"supabaseApi": {"id": "", "name": "Supabase Lumen"}}

# Lit le modèle Ollama actif choisi depuis l'onglet "Modèles IA" du pilotage (table
# ia_parametres), avec repli sur le modèle par défaut si la table est vide, absente,
# ou si Supabase ne répond pas. Collé en tête des code nodes qui ont besoin de MODELE.
LIRE_MODELE_ACTIF = r"""
async function modeleActif(defaut) {
  try {
    const r = await this.helpers.httpRequest({ method: 'GET',
      url: '""" + SUPABASE_URL + r"""/rest/v1/ia_parametres?id=eq.1&select=modele',
      headers: { apikey: '""" + SUPABASE_ANON_KEY + r"""', Authorization: 'Bearer """ + SUPABASE_ANON_KEY + r"""' },
      json: true, timeout: 4000 });
    return (Array.isArray(r) && r[0] && r[0].modele) || defaut;
  } catch (e) { return defaut; }
}
"""

def sb_http(id_, name, pos, method, path_expr, body_expr=None, prefer=None, always=True, cont=True):
    p = {"method": method, "url": "=" + path_expr,
         "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
         "options": {"timeout": 60000}}
    headers = [{"name": "Content-Type", "value": "application/json"}]
    if prefer:
        headers.append({"name": "Prefer", "value": prefer})
    p["sendHeaders"] = True
    p["headerParameters"] = {"parameters": headers}
    if body_expr:
        p["sendBody"] = True; p["specifyBody"] = "json"; p["jsonBody"] = body_expr
    n = {"id": id_, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
         "parameters": p, "credentials": SB_CRED}
    if always: n["alwaysOutputData"] = True
    if cont: n["continueOnFail"] = True
    return n

def code(id_, name, pos, js, once=True):
    n = {"id": id_, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": js.strip()}}
    if not once: n["parameters"]["mode"] = "runOnceForEachItem"
    return n

def chain(names):
    return {names[i]: {"main": [[{"node": names[i + 1], "type": "main", "index": 0}]]} for i in range(len(names) - 1)}

NORMALISER = r"""
const arr = v => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
const chercher = (o, test, out = []) => { if (o && typeof o === 'object') for (const k in o) { if (test(k, o[k])) out.push(o[k]); chercher(o[k], test, out); } return out; };
const num = v => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) && n > 1 ? n : null; };
function normaliser(r) {
  let d = {}; try { d = typeof r.donnees === 'string' ? JSON.parse(r.donnees) : (r.donnees || {}); } catch (e) {}
  const lots = chercher(d, (k, v) => /^estimationValeur$/i.test(k) && v && typeof v === 'object').map(x => num(x.valeur)).filter(Boolean);
  const vals = chercher(d, (k, v) => /^(valeur|valeurHaute)$/i.test(k) && typeof v !== 'object').map(num).filter(Boolean);
  const montant = lots.length > 1 ? lots.reduce((a, b) => a + b, 0) : (vals[0] || lots[0] || null);
  const lieu = (chercher(d, (k, v) => /^lieuExecution$/i.test(k) && typeof v === 'string')[0] || '')
    .replace(/\s+/g, ' ').replace(/^FR[A-Z0-9]*\s*-\s*/i, '').replace(/,\s*-\s*/g, ', ').slice(0, 120);
  const duree = Number(chercher(d, (k, v) => /^dureeMois$/i.test(k) && typeof v !== 'object')[0]) || null;
  const nbLots = chercher(d, (k, v) => /^lot$/i.test(k) && Array.isArray(v))[0]?.length || null;
  return {
    avis_id: String(r.idweb || r.id || ''), objet: String(r.objet || '').trim().slice(0, 1000), acheteur: String(r.nomacheteur || '').slice(0, 300),
    departements: arr(r.code_departement).map(c => /^\d$/.test(c) ? '0' + c : String(c)),
    lieu: lieu || null, type_marche: arr(r.type_marche_facette).join(', ') || arr(r.type_marche).join(', ') || null,
    procedure: r.procedure_libelle || null, descripteurs: arr(r.descripteur_libelle).join(', ') || null,
    montant, duree_mois: duree, nb_lots: nbLots, parution: r.dateparution || null, limite: r.datelimitereponse || null,
    url: r.url_avis || ('https://www.boamp.fr/pages/avis/?q=idweb:' + r.idweb)
  };
}
"""

# =====================================================================
#  AGENT E9 : BOAMP (ex "Agent A" — même logique, déplacée dans la série des
#  sous-agents plateformes E1-E8 : le BOAMP est traité comme une 9ème source,
#  au même titre que PLACE, AWS-Achat, etc. Seule différence : une API
#  officielle légère plutôt qu'un scraping Playwright, donc un rythme plus
#  rapide (toutes les 2 h, comme avant).
# =====================================================================
A_COLLECTE = r"""
// ===== RÉGLAGES =====
const JOURS = 2;          // avis publiés ces 2 derniers jours (les doublons sont ignorés).
                          // Pour le tout premier lancement, mets 20 pour remplir la base, puis remets 2.
const MAX_PAGES = 99;     // 100 avis par page, 9 900 au maximum par passage
// =====================
""" + NORMALISER + r"""
const debut = new Date().toISOString();
const since = new Date(Date.now() - JOURS * 864e5).toISOString().slice(0, 10);
const where = `nature="APPEL_OFFRE" AND dateparution>=date'${since}'`;
const base = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';
let lus = 0, total = 0; const lignes = []; let erreur = null;
try {
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await this.helpers.httpRequest({ method: 'GET', url: base, qs: { where, order_by: 'dateparution desc', limit: 100, offset: page * 100 }, json: true, timeout: 30000 });
    const res = j.results || []; total = j.total_count || total; lus += res.length;
    for (const r of res) { const o = normaliser(r); if (o.avis_id && o.objet) lignes.push(o); }
    if (res.length < 100 || lus >= total) break;
  }
} catch (e) { erreur = 'Lecture du BOAMP impossible : ' + (e.message || e); }
const vus = new Set(); const uniques = lignes.filter(o => !vus.has(o.avis_id) && vus.add(o.avis_id));
// Paquets de 500 offres : un enregistrement par paquet
const paquets = []; for (let i = 0; i < uniques.length; i += 500) paquets.push(uniques.slice(i, i + 500));
if (!paquets.length) paquets.push([]);
return paquets.map((p, i) => ({ json: { debut, lus, total, nb: uniques.length, lignes: p, erreur, paquet: i + 1 } }));
"""

A_JOURNAL = r"""
const c = $('Collecter le BOAMP').first().json;
const erreurs = $input.all().map(i => i.json).filter(x => x && x.error);
let statut = 'ok', message = null;
if (c.erreur) { statut = 'erreur'; message = c.erreur; }
else if (erreurs.length) { statut = 'erreur'; message = 'Enregistrement dans Supabase impossible : ' + JSON.stringify(erreurs[0].error).slice(0, 300); }
else if (!c.nb) statut = 'vide';
return [{ json: { agent: 'E9-boamp', debut: c.debut, fin: new Date().toISOString(), statut, entrees: c.lus, sorties: statut === 'erreur' ? 0 : c.nb,
  details: { avis_disponibles: c.total, paquets: $input.all().length }, message } }];
"""

e9_nodes = [
    {"id": "e9-1", "name": "Toutes les 2 heures", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 6-20/2 * * *"}]}}},
    code("e9-2", "Collecter le BOAMP", [220, 0], A_COLLECTE),
    sb_http("e9-3", "Enregistrer les offres", [440, 0], "POST", SUPABASE_URL + "/rest/v1/offres?on_conflict=avis_id",
            body_expr="={{ JSON.stringify($json.lignes.length ? $json.lignes : []) }}", prefer="resolution=merge-duplicates,return=minimal"),
    code("e9-4", "Préparer le journal", [660, 0], A_JOURNAL),
    sb_http("e9-5", "Écrire le journal", [880, 0], "POST", SUPABASE_URL + "/rest/v1/agent_runs",
            body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
]
agent_e9 = {"name": "Lumen – Agent E9 : BOAMP", "nodes": e9_nodes,
            "connections": chain([n["name"] for n in e9_nodes]), "settings": {"executionOrder": "v1"}, "pinData": {}}

# =====================================================================
#  AGENT A : COORDINATEUR DE LA COLLECTE
#  Ne récupère plus rien lui-même : vérifie toutes les 3 h que les 9 sous-
#  agents (BOAMP + 8 plateformes) ont bien tourné, et consigne un journal
#  consolidé. "entrées" = les 9 sous-agents suivis (constant) ; "sorties" =
#  combien d'entre eux sont à jour (ni en erreur, ni sans passage récent).
#  Le total d'offres actuellement en base est noté à part, dans le détail
#  du journal, plutôt que comme "sorties" : sinon il faudrait le resommer
#  à chaque passage et il gonflerait dans le graphique de production,
#  exactement le malentendu repéré sur l'agent A avant cette refonte.
# =====================================================================
SOUS_AGENTS_COLLECTE = ["E9-boamp", "E1-place", "E2-aws", "E3-emp", "E4-maximilien", "E5-klekoon", "E6-ebourgogne", "E7-megalis", "E8-achatpublic"]

A_REPERES = r"""
const CODES = """ + json.dumps(SOUS_AGENTS_COLLECTE) + r""";
return [{ json: { debut: new Date().toISOString(), since: new Date(Date.now() - 48 * 36e5).toISOString(),
  codes: CODES, filtre: 'agent=in.(' + CODES.join(',') + ')' } }];
"""

A_JOURNAL_COORD = r"""
const runs = $('Lire les 9 sous-agents').all().map(i => i.json);
const R = $('Repères').first().json, CODES = R.codes;
const parAgent = {};
for (const r of runs) { if (!parAgent[r.agent]) parAgent[r.agent] = r; } // déjà trié du plus récent au plus ancien
const manquants = CODES.filter(c => !parAgent[c]);
const enErreur = CODES.filter(c => parAgent[c] && parAgent[c].statut === 'erreur');
const aJour = CODES.length - manquants.length - enErreur.length;
let total = null;
try {
  const cr = ($('Compter les offres').first().json.headers || {})['content-range'] || '';
  const m = /\/(\d+)$/.exec(cr); total = m ? Number(m[1]) : null;
} catch (e) {}
let statut = 'ok', message = null;
if (manquants.length === CODES.length) { statut = 'vide'; message = "Aucun des 9 sous-agents n'a encore de passage."; }
else if (enErreur.length) { statut = 'erreur'; message = enErreur.length + ' sous-agent(s) en erreur : ' + enErreur.join(', '); }
else if (manquants.length) { message = manquants.length + ' sous-agent(s) sans passage récent (48 h) : ' + manquants.join(', '); }
return [{ json: { agent: 'A-collecteur', debut: R.debut, fin: new Date().toISOString(), statut,
  entrees: CODES.length, sorties: aJour, details: { manquants, en_erreur: enErreur, offres_en_base: total }, message } }];
"""

def sb_count(id_, name, pos, path_expr):
    return {"id": id_, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "parameters": {"method": "GET", "url": "=" + path_expr,
                "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
                "sendHeaders": True, "headerParameters": {"parameters": [{"name": "Prefer", "value": "count=exact"}]},
                "options": {"timeout": 30000, "response": {"response": {"fullResponse": True, "neverError": True}}}},
            "credentials": SB_CRED, "alwaysOutputData": True, "continueOnFail": True}

a_coord_nodes = [
    {"id": "ac1", "name": "Toutes les 3 heures", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 */3 * * *"}]}}},
    code("ac2", "Repères", [220, 0], A_REPERES),
    sb_http("ac3", "Lire les 9 sous-agents", [440, 0], "GET",
            SUPABASE_URL + "/rest/v1/agent_runs?{{ $json.filtre }}&debut=gte.{{ $json.since }}&select=agent,debut,statut&order=debut.desc&limit=500"),
    sb_count("ac4", "Compter les offres", [660, 0], SUPABASE_URL + "/rest/v1/offres?select=avis_id&limit=1"),
    code("ac5", "Préparer le journal", [880, 0], A_JOURNAL_COORD),
    sb_http("ac6", "Écrire le journal", [1100, 0], "POST", SUPABASE_URL + "/rest/v1/agent_runs",
            body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
]
agent_a = {"name": "Lumen – Agent A : coordinateur de la collecte", "nodes": a_coord_nodes,
           "connections": chain([n["name"] for n in a_coord_nodes]), "settings": {"executionOrder": "v1"}, "pinData": {}}

# =====================================================================
#  AGENT F : PROSPECTION COMMERCIALE
#  Cherche chaque jour des entreprises qui répondent effectivement à des
#  marchés publics (donc des clientes potentielles pour Lumen), partout en
#  France. Source : les avis d'ATTRIBUTION du BOAMP (même dataset que le
#  BOAMP-collecteur E9, mais nature != "APPEL_OFFRE") — ces avis nomment
#  l'entreprise qui a remporté le marché (titulaire/attributaire), ce qui
#  est exactement le signal recherché, et c'est une source officielle,
#  gratuite, déjà utilisée dans ce projet.
#
#  Ne fait QUE découvrir et enregistrer ces entreprises dans la table
#  "entreprises" (statut "à qualifier") — pas d'envoi d'email pour
#  l'instant, voir discussion avec l'utilisateur. Plafonné à 100 nouvelles
#  entreprises par jour (dédoublonnées par SIRET).
#
#  ATTENTION : l'exploration exacte des champs "titulaire/SIRET" dans le
#  JSON brut des avis d'attribution n'a pas pu être testée en direct depuis
#  cet environnement (pas d'accès réseau au BOAMP). L'extraction ci-dessous
#  recherche ces informations de façon tolérante (n'importe quelle clé qui
#  ressemble à "siret"/"denomination"/"titulaire", à n'importe quel niveau
#  d'imbrication), sur le même principe que normaliser() pour les avis
#  d'appel d'offres. À vérifier au premier passage réel dans n8n : si le
#  nombre d'entreprises trouvées reste à 0 alors que des avis sont bien
#  lus, regarder le détail d'un avis d'attribution brut (onglet "Output"
#  du nœud "Chercher les attributions BOAMP") pour ajuster les motifs de
#  recherche.
# =====================================================================
F_CHERCHE = r"""
// ===== RÉGLAGES =====
const JOURS = 10;          // avis d'attribution publiés ces 10 derniers jours
const MAX_PAGES = 30;      // 100 avis par page
const CIBLE = 100;         // nouvelles entreprises à trouver par jour
// =====================
const arr = v => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
const chercher = (o, test, out = []) => { if (o && typeof o === 'object') for (const k in o) { if (test(k, o[k])) out.push(o[k]); chercher(o[k], test, out); } return out; };
const estSiret = v => typeof v === 'string' && /^\d{9,14}$/.test(v.replace(/\s/g, ''));

const debut = new Date().toISOString();
const since = new Date(Date.now() - JOURS * 864e5).toISOString().slice(0, 10);
// "APPEL_OFFRE" est la seule nature déjà bien identifiée (avis d'appel à candidature) ;
// tout le reste (attributions, rectificatifs sans titulaire, etc.) est donc inclus ici,
// et on filtre ensuite sur la présence réelle d'un SIRET pour ne garder que les
// vraies attributions à une entreprise.
const where = `nature!="APPEL_OFFRE" AND dateparution>=date'${since}'`;
const base = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';
let lus = 0, total = 0; const candidats = []; let erreur = null;
try {
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await this.helpers.httpRequest({ method: 'GET', url: base, qs: { where, order_by: 'dateparution desc', limit: 100, offset: page * 100 }, json: true, timeout: 30000 });
    const res = j.results || []; total = j.total_count || total; lus += res.length;
    for (const r of res) {
      let d = {}; try { d = typeof r.donnees === 'string' ? JSON.parse(r.donnees) : (r.donnees || {}); } catch (e) {}
      const sirets = chercher(d, (k, v) => /siret/i.test(k) && estSiret(v));
      const siret = sirets[0]; if (!siret) continue;
      const noms = chercher(d, (k, v) => /denomination|raisonsociale|nomtitulaire|nomattributaire/i.test(k) && typeof v === 'string' && v.trim());
      const nom = (noms[0] || '').trim(); if (!nom) continue;
      const villes = chercher(d, (k, v) => /^ville$/i.test(k) && typeof v === 'string');
      const vals = chercher(d, (k, v) => /^(valeur|valeurHaute|montant)$/i.test(k) && typeof v !== 'object').map(Number).filter(n => isFinite(n) && n > 1);
      const cp = r.code_departement, dep = arr(cp)[0] ? (/^\d$/.test(arr(cp)[0]) ? '0' + arr(cp)[0] : String(arr(cp)[0])) : null;
      candidats.push({ siret: siret.replace(/\s/g, ''), siren: siret.replace(/\s/g, '').slice(0, 9), nom: nom.slice(0, 300),
        ville: (villes[0] || '').slice(0, 120) || null, departement: dep, source_marche: String(r.objet || '').slice(0, 500),
        montant_marche: vals[0] || null, date_attribution: r.dateparution || null });
    }
    if (res.length < 100 || lus >= total) break;
  }
} catch (e) { erreur = 'Lecture du BOAMP (attributions) impossible : ' + (e.message || e); }
const vus = new Set(); const uniques = candidats.filter(c => !vus.has(c.siret) && vus.add(c.siret));
return [{ json: { debut, lus, total, candidats: uniques, cible: CIBLE, erreur } }];
"""

F_FILTRER = r"""
// Enlève les entreprises déjà connues (table "entreprises") et plafonne à la cible du jour.
const c = $('Chercher les attributions BOAMP').first().json;
const connus = new Set($('Lire les entreprises connues').all().map(i => i.json).filter(x => x && x.siret).map(x => x.siret));
const nouvelles = c.candidats.filter(x => !connus.has(x.siret)).slice(0, c.cible)
  .map(x => ({ ...x, statut: 'à qualifier', trouve_le: new Date().toISOString() }));
return [{ json: { debut: c.debut, lus: c.lus, candidats_vus: c.candidats.length, nouvelles, erreur: c.erreur } }];
"""

F_JOURNAL = r"""
const c = $('Garder les nouvelles').first().json;
const erreurs = $input.all().map(i => i.json).filter(x => x && x.error);
let statut = 'ok', message = null;
if (c.erreur) { statut = 'erreur'; message = c.erreur; }
else if (erreurs.length) { statut = 'erreur'; message = 'Enregistrement dans Supabase impossible : ' + JSON.stringify(erreurs[0].error).slice(0, 300); }
else if (!c.nouvelles.length) statut = 'vide';
return [{ json: { agent: 'F-commercial', debut: c.debut, fin: new Date().toISOString(), statut, entrees: c.lus, sorties: c.nouvelles.length,
  details: { candidats_vus: c.candidats_vus }, message } }];
"""

def sb_check(id_, name, pos, path_expr):
    # Variante de sb_http qui ne doit jamais faire échouer la branche suivante, même sur
    # une liste de SIRET vide (où l'URL contiendrait "siret=in.()", invalide côté Postgrest).
    n = sb_http(id_, name, pos, "GET", path_expr)
    return n

f_nodes = [
    {"id": "f1", "name": "Chaque jour à 5 h", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 5 * * *"}]}}},
    code("f2", "Chercher les attributions BOAMP", [220, 0], F_CHERCHE),
    sb_check("f3", "Lire les entreprises connues", [440, 0],
             SUPABASE_URL + "/rest/v1/entreprises?select=siret&siret=in.({{ $json.candidats.map(c => c.siret).join(',') || '0' }})&limit=5000"),
    code("f4", "Garder les nouvelles", [660, 0], F_FILTRER),
    sb_http("f5", "Enregistrer les entreprises", [880, 0], "POST", SUPABASE_URL + "/rest/v1/entreprises?on_conflict=siret",
            body_expr="={{ JSON.stringify($json.nouvelles.length ? $json.nouvelles : []) }}", prefer="resolution=merge-duplicates,return=minimal"),
    code("f6", "Préparer le journal", [1100, 0], F_JOURNAL),
    sb_http("f7", "Écrire le journal", [1320, 0], "POST", SUPABASE_URL + "/rest/v1/agent_runs",
            body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
]
agent_f = {"name": "Lumen – Agent F : prospection commerciale", "nodes": f_nodes,
           "connections": chain([n["name"] for n in f_nodes]), "settings": {"executionOrder": "v1"}, "pinData": {}}

# =====================================================================
#  AGENT B : TRI PAR CLIENT (Ollama)
# =====================================================================
B_REGLAGES = r"""
""" + LIRE_MODELE_ACTIF + r"""
// ===== RÉGLAGES =====
const OLLAMA_URL = 'http://127.0.0.1:11434';     // Ollama sur ton ordinateur (127.0.0.1 plutôt que localhost)
const MODELE = await modeleActif('qwen2.5:7b');  // modèle choisi dans l'onglet "Modèles IA" du pilotage (par défaut : qwen2.5:7b)
const JOURS = 3;                                 // offres publiées ces 3 derniers jours
const MAX_PAR_CLIENT = 15;                       // offres envoyées à l'IA par client
// =====================
const auj = new Date().toISOString().slice(0, 10);
return [{ json: { OLLAMA_URL, MODELE, JOURS, MAX_PAR_CLIENT, debut: new Date().toISOString(),
  depuis: new Date(Date.now() - JOURS * 864e5).toISOString().slice(0, 10),
  il_y_a_30j: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), auj } }];
"""

B_PREPARER = r"""
// Pour chaque client actif : pré-sélection des offres (zone, type, montant, mots-clés, exclusions), puis demande à l'IA.
const R = $('Réglages').first().json;
const clients = $('Lire les clients').all().map(i => i.json).filter(c => c && c.id && c.email);
const offres = $('Lire les offres récentes').all().map(i => i.json).filter(o => o && o.avis_id);
const deja = new Set($('Lire les offres déjà envoyées').all().map(i => i.json).filter(x => x && x.client_id).map(x => x.client_id + '|' + x.avis_id));
const sans = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const liste = s => String(s || '').split(/[,;]+/).map(x => x.trim()).filter(x => x.length > 2);
const dansDeuxJours = Date.now() + 2 * 864e5;
const out = [];
let candidatsTotal = 0;
for (const c of clients) {
  if (c.actif === false) continue;
  if (String(c.formule || 'essai') === 'essai' && c.fin_essai && new Date(c.fin_essai + 'T23:59:59') < new Date()) continue;
  const deps = new Set(String(c.departements || '').split(/[,;\s]+/).filter(Boolean).map(d => /^\d$/.test(d) ? '0' + d : d));
  const types = String(c.types || '').toUpperCase().split(/[,;\s]+/).filter(Boolean);
  const mots = [...liste(c.mots_cles), ...liste(c.metiers)].map(sans);
  const excl = liste(c.exclusions).map(sans);
  const min = Number(c.montant_min) || 0;
  let cand = offres.filter(o => {
    if (deja.has(c.id + '|' + o.avis_id)) return false;
    if (o.limite && new Date(o.limite).getTime() < dansDeuxJours) return false;
    if (deps.size && !(o.departements || []).some(d => deps.has(d))) return false;
    if (types.length && types.length < 3 && !types.some(t => sans(o.type_marche).includes(sans(t)))) return false;
    if (min && o.montant && Number(o.montant) < min) return false;
    const texte = sans(o.objet + ' ' + (o.descripteurs || ''));
    if (excl.some(m => texte.includes(m))) return false;
    if (mots.length && !mots.some(m => texte.includes(m))) return false;
    return true;
  }).sort((a, b) => String(b.parution).localeCompare(String(a.parution))).slice(0, R.MAX_PAR_CLIENT);
  candidatsTotal += cand.length;
  if (!cand.length) continue;
  const prompt = `Tu aides une PME à repérer les appels d'offres publics qui lui conviennent.

ENTREPRISE
Nom : ${c.entreprise}
Activité : ${c.metiers || 'non précisée'}
Présentation : ${c.description || 'non renseignée'}
Qualifications : ${c.qualifications || 'non renseignées'}
Taille : ${c.effectif || 'effectif non précisé'}, chiffre d'affaires ${c.ca_annuel || 'non précisé'}
Zone : départements ${c.departements || 'non précisés'}
Montant minimum souhaité : ${c.montant_min ? c.montant_min + ' €' : 'aucun'}
Marchés déjà remportés : ${String(c.marches_gagnes || 'inconnus').slice(0, 1200)}

OFFRES À NOTER (JSON)
${JSON.stringify(cand.map(o => ({ id: o.avis_id, objet: o.objet, acheteur: o.acheteur, lieu: o.lieu, type: o.type_marche, domaines: o.descripteurs, montant: o.montant, duree_mois: o.duree_mois })))}

CONSIGNES (sois ouvert : il vaut mieux proposer une offre de trop qu'en rater une)
- 5 : en plein dans le métier de l'entreprise et à sa taille.
- 4 : dans son métier, même si un détail ne colle pas tout à fait (montant, lieu, durée).
- 3 : en partie dans son métier, par exemple un lot du marché, une prestation proche, ou une sous-traitance possible.
- 2 : lien faible avec son activité.
- 1 : un tout autre métier.
- Un marché découpé en lots mérite au moins 3 si l'un des lots peut correspondre.
- La présentation de l'entreprise donne des exemples, pas une liste fermée : reste large sur les activités voisines.
- Résumé : une phrase simple en français. Pourquoi : une phrase qui explique le lien avec l'entreprise.
- N'invente rien : appuie-toi uniquement sur les informations ci-dessus.
Réponds UNIQUEMENT avec ce JSON : {"offres":[{"id":"...","score":1,"resume":"...","pourquoi":"..."}]}`;
  out.push({ json: { vide: false, client: { id: c.id, email: c.email, entreprise: c.entreprise }, candidats: cand,
    ollama: { model: R.MODELE, stream: false, format: 'json', options: { temperature: 0.1, num_ctx: 16384 },
      messages: [{ role: 'system', content: "Tu es un expert des marchés publics français. Tu réponds toujours en JSON valide, en français." }, { role: 'user', content: prompt }] } } });
}
if (!out.length) return [{ json: { vide: true, clients: clients.length, candidats: 0 } }];
out[0].json.stats = { clients: clients.length, candidats: candidatsTotal };
return out;
"""

B_LIRE = r"""
// Lit la réponse de l'IA pour chaque client : garde les offres notées 3 ou plus, prépare l'email et les lignes à enregistrer.
const prepares = $('Préparer par client').all();
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtL = d => { if (!d) return 'non précisée'; const t = new Date(d); return isNaN(t) ? d : t.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }); };
const fmtM = n => !n ? 'Montant non communiqué' : n >= 1e6 ? '≈ ' + (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€ HT' : '≈ ' + Math.round(n / 1e3) + ' k€ HT';
const auj = new Date().toISOString().slice(0, 10);
const out = [];
$input.all().forEach((it, i) => {
  const p = prepares[i]?.json; if (!p || p.vide) return;
  let notes = [], erreur = null;
  if (it.json.error) erreur = 'Ollama injoignable ou trop lent : ' + JSON.stringify(it.json.error).slice(0, 200);
  else {
    const txt = it.json.message?.content || it.json.response || '';
    try { const j = JSON.parse(txt); notes = Array.isArray(j) ? j : (j.offres || []); }
    catch (e) { const m = String(txt).match(/\{[\s\S]*\}/); try { notes = JSON.parse(m[0]).offres || []; } catch (e2) { erreur = "Réponse de l'IA illisible"; } }
  }
  const byId = Object.fromEntries(p.candidats.map(o => [String(o.avis_id), o]));
  const garde = (Array.isArray(notes) ? notes : []).filter(n => Number(n.score) >= 3 && byId[String(n.id)])
    .sort((a, b) => b.score - a.score).slice(0, 8);
  const lignes = garde.map(n => { const o = byId[String(n.id)]; return { client_id: p.client.id, date_envoi: auj, avis_id: o.avis_id, objet: o.objet.slice(0, 500),
    acheteur: o.acheteur, departement: (o.departements || []).join(', '), lieu: o.lieu, montant: o.montant || null, limite: o.limite || null,
    score: Math.max(1, Math.min(5, Math.round(Number(n.score)))), resume: String(n.resume || '').slice(0, 500), url: o.url }; });
  let html = null, sujet = null;
  if (lignes.length) {
    sujet = `${lignes.length} appel${lignes.length > 1 ? 's' : ''} d'offres pour vous ce matin`;
    html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#18222e"><p>Bonjour,</p><p>Voici les appels d'offres sélectionnés pour ${esc(p.client.entreprise)} ce matin.</p>` +
      garde.map((n, k) => { const o = byId[String(n.id)]; return `<div style="padding:14px 0;border-bottom:1px solid #d5dbe2">
        <div style="font-weight:700;font-size:16px">${esc(o.objet)}</div>
        <div style="font-size:13px;color:#5a6676;margin:4px 0">${esc(o.acheteur)}${o.lieu ? ', ' + esc(o.lieu) : ''}. Réponse avant le ${esc(fmtL(o.limite))}. Pertinence ${esc(lignes[k].score)}/5</div>
        <div style="font-size:13px;color:#8a5a00;font-weight:bold;margin-bottom:4px">${esc(fmtM(o.montant))}</div>
        <div style="font-size:14px">${esc(n.resume)}</div>
        <div style="font-size:14px;color:#24476b;margin-top:4px"><b>Pourquoi pour vous :</b> ${esc(n.pourquoi)}</div>
        <div style="margin-top:6px"><a href="${esc(o.url)}" style="color:#24476b">Voir l'avis officiel</a></div></div>`; }).join('') +
      `<p style="margin-top:16px">Retrouvez ces offres, le calendrier des dates limites et l'analyse des dossiers dans votre espace Lumen Marchés.</p><p>L'équipe Lumen</p>
      <p style="font-size:12px;color:#5a6676">Source : BOAMP. Sélection faite par une IA : vérifiez toujours les dates sur l'avis officiel.</p></div>`;
  }
  out.push({ json: { client_id: p.client.id, email: p.client.email, lignes, sujet, html, candidats: p.candidats.length, gardees: lignes.length, erreur } });
});
return out;
"""

B_LIGNES = r"""
// Toutes les offres retenues, pour un seul enregistrement dans Supabase.
const lignes = $input.all().flatMap(i => i.json.lignes || []);
return [{ json: { lignes } }];
"""

B_EMAILS = r"""
// Un email par client qui a au moins une offre.
return $input.all().filter(i => i.json.html && i.json.email).map(i => ({ json: { to: i.json.email, subject: i.json.sujet, html: i.json.html } }));
"""

B_JOURNAL = r"""
const R = $('Réglages').first().json;
const items = $input.all().map(i => i.json);
let statut = 'ok', message = null, entrees = 0, sorties = 0;
const details = { modele: R.MODELE };
if (items.length === 1 && items[0].vide) { statut = 'vide'; entrees = items[0].clients || 0; details.raison = 'aucune offre pré-sélectionnée'; }
else {
  entrees = items.length; sorties = items.reduce((s, x) => s + (x.gardees || 0), 0);
  details.candidats = items.reduce((s, x) => s + (x.candidats || 0), 0);
  details.clients_servis = items.filter(x => x.gardees > 0).length;
  const err = items.filter(x => x.erreur);
  if (err.length) { details.erreurs = err.length; message = err[0].erreur; if (err.length === items.length) statut = 'erreur'; }
  if (statut === 'ok' && !sorties) statut = 'vide';
}
return [{ json: { agent: 'B-tri', debut: R.debut, fin: new Date().toISOString(), statut, entrees, sorties, details, message } }];
"""

S = SUPABASE_URL + "/rest/v1/"
b_nodes = [
    {"id": "b1", "name": "Chaque matin 6 h 45", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "45 6 * * 1-5"}]}}},
    code("b2", "Réglages", [200, 0], B_REGLAGES),
    sb_http("b3", "Lire les clients", [400, 0], "GET", S + "profils?actif=eq.true&select=*"),
    {**sb_http("b4", "Lire les offres récentes", [600, 0], "GET",
               S + "offres?parution=gte.{{ $('Réglages').first().json.depuis }}&select=*&order=parution.desc&limit=5000"), "executeOnce": True},
    {**sb_http("b5", "Lire les offres déjà envoyées", [800, 0], "GET",
               S + "offres_envoyees?date_envoi=gte.{{ $('Réglages').first().json.il_y_a_30j }}&select=client_id,avis_id&limit=50000"), "executeOnce": True},
    {**code("b6", "Préparer par client", [1000, 0], B_PREPARER), "executeOnce": True},
    {"id": "b7", "name": "Des offres à trier ?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [1200, 0],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
        "conditions": [{"id": "c1", "leftValue": "={{ $json.vide }}", "rightValue": False, "operator": {"type": "boolean", "operation": "equals"}}],
        "combinator": "and"}, "options": {}}},
    {"id": "b8", "name": "L'IA trie (Ollama)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1420, -80],
     "continueOnFail": True, "alwaysOutputData": True,
     "parameters": {"method": "POST", "url": "={{ $('Réglages').first().json.OLLAMA_URL }}/api/chat",
        "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.ollama) }}",
        "options": {"timeout": 900000, "batching": {"batch": {"batchSize": 1, "batchInterval": 0}}}}},
    code("b9", "Lire les réponses", [1640, -80], B_LIRE),
    code("b10", "Regrouper les offres", [1860, -200], B_LIGNES),
    sb_http("b11", "Enregistrer les offres du client", [2080, -200], "POST", S + "offres_envoyees?on_conflict=client_id,avis_id",
            body_expr="={{ JSON.stringify($json.lignes) }}", prefer="resolution=merge-duplicates,return=minimal"),
    code("b12", "Préparer les emails", [1860, -80], B_EMAILS),
    {"id": "b13", "name": "Envoyer la veille", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [2080, -80], "continueOnFail": True,
     "credentials": {"smtp": {"id": "", "name": "Brevo SMTP"}},
     "parameters": {"fromEmail": "Lumen Marchés <lumeniaindustrie@gmail.com>", "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}",
                    "emailFormat": "html", "html": "={{ $json.html }}", "options": {"appendAttribution": False}}},
    code("b14", "Préparer le journal", [1860, 80], B_JOURNAL),
    sb_http("b15", "Écrire le journal", [2080, 80], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
]
C = lambda n: {"node": n, "type": "main", "index": 0}
b_conn = chain(["Chaque matin 6 h 45", "Réglages", "Lire les clients", "Lire les offres récentes", "Lire les offres déjà envoyées", "Préparer par client", "Des offres à trier ?"])
b_conn["Des offres à trier ?"] = {"main": [[C("L'IA trie (Ollama)")], [C("Préparer le journal")]]}
b_conn["L'IA trie (Ollama)"] = {"main": [[C("Lire les réponses")]]}
b_conn["Lire les réponses"] = {"main": [[C("Regrouper les offres"), C("Préparer les emails"), C("Préparer le journal")]]}
b_conn["Regrouper les offres"] = {"main": [[C("Enregistrer les offres du client")]]}
b_conn["Préparer les emails"] = {"main": [[C("Envoyer la veille")]]}
b_conn["Préparer le journal"] = {"main": [[C("Écrire le journal")]]}
agent_b = {"name": "Lumen – Agent B : tri des offres par client (Ollama)", "nodes": b_nodes, "connections": b_conn,
           "settings": {"executionOrder": "v1"}, "pinData": {}}

json.dump(agent_e9, open(os.path.join(OUT, "n8n_agent_E9_boamp.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(agent_a, open(os.path.join(OUT, "n8n_agent_A_collecteur.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(agent_b, open(os.path.join(OUT, "n8n_agent_B_tri_ollama.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(agent_f, open(os.path.join(OUT, "n8n_agent_F_commercial.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
for nm, js in [("a_collecte", A_COLLECTE), ("a_journal", A_JOURNAL), ("a_reperes", A_REPERES), ("a_journal_coord", A_JOURNAL_COORD),
               ("b_reglages", B_REGLAGES), ("b_preparer", B_PREPARER), ("b_lire", B_LIRE), ("b_lignes", B_LIGNES), ("b_emails", B_EMAILS), ("b_journal", B_JOURNAL),
               ("f_cherche", F_CHERCHE), ("f_filtrer", F_FILTRER), ("f_journal", F_JOURNAL)]:
    open(os.path.join(OUT, f"_chk_{nm}.js"), "w").write("async function f(){" + js + "}")
print("ok")
