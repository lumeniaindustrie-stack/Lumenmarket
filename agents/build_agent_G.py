"""Génère l'agent G (contrôleur) pour n8n en local."""
import json, os
from build_agents_local import sb_http, code, SUPABASE_URL  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
S = SUPABASE_URL + "/rest/v1/"

G_REGLAGES = r"""
// ===== RÉGLAGES =====
const EMAIL_ALERTE = 'marinsauzay991@gmail.com';   // qui reçoit les alertes
const OLLAMA_URL = 'http://127.0.0.1:11434';
const HEURE_RAPPORT = 21;                          // rapport du jour envoyé au passage de 21 h
const SILENCE_HEURES = 6;                          // ne répète pas la même alerte avant 6 h
// =====================
const now = new Date();
return [{ json: { EMAIL_ALERTE, OLLAMA_URL, HEURE_RAPPORT, SILENCE_HEURES, debut: now.toISOString(), depuis: new Date(now - 48 * 36e5).toISOString() } }];
"""

G_VERIFIER = r"""
const R = $('Réglages').first().json;
const runs = $('Lire le journal').all().map(i => i.json).filter(r => r && r.agent)
  .sort((a, b) => a.debut < b.debut ? 1 : -1);
const now = new Date(), h = now.getHours(), jour = now.getDay();
const depuis = (iso) => (now - new Date(iso)) / 36e5;
const hm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const de = (agent) => runs.filter(r => r.agent === agent);
const alertes = [];
const ajouter = (cle, texte) => alertes.push({ cle, texte });

// ---------- Agent A : collecteur (toutes les 2 h de 6 h à 20 h) ----------
const A = de('A-collecteur'), dA = A[0];
if (!dA) ajouter('A-jamais', "L'agent A (collecteur) n'a aucune exécution depuis 48 h.");
else {
  if (dA.statut === 'erreur') ajouter('A-erreur-' + dA.id, `L'agent A a échoué à ${hm(dA.debut)} : ${dA.message || 'erreur inconnue'}`);
  if (h >= 7 && h <= 21 && depuis(dA.debut) > 3) ajouter('A-retard', `L'agent A n'a pas tourné depuis ${hm(dA.debut)} (${Math.round(depuis(dA.debut))} h).`);
  const A24 = A.filter(r => depuis(r.debut) <= 24);
  if (h >= 12 && A24.length >= 3 && !A24.some(r => (r.sorties || 0) > 0)) ajouter('A-zero', "L'agent A tourne mais n'a stocké aucune offre depuis 24 h : vérifie le BOAMP ou la connexion à Supabase.");
}

// ---------- Agent B : tri (en semaine à 9 h) ----------
const B = de('B-tri'), dB = B[0];
const debutJour = new Date(now); debutJour.setHours(6, 0, 0, 0);
if (jour >= 1 && jour <= 5 && h >= 10 && !(dB && new Date(dB.debut) >= debutJour)) ajouter('B-retard', "L'agent B n'a pas envoyé la veille ce matin (aucune exécution ce matin, prévue à 9 h).");
if (dB && dB.statut === 'erreur' && depuis(dB.debut) <= 24) ajouter('B-erreur-' + dB.id, `L'agent B a échoué à ${hm(dB.debut)} : ${dB.message || 'erreur inconnue'}`);

// ---------- Agents C et D : erreurs et file d'attente ----------
for (const [code, nom] of [['C-chat', "L'agent C (chat client)"], ['D-analyse', "L'agent D (analyse des dossiers)"]]) {
  const err = de(code).filter(r => r.statut === 'erreur' && depuis(r.debut) <= 2);
  if (err.length) ajouter(code + '-erreur-' + err[0].id, `${nom} a eu ${err.length} échec(s) depuis 2 h, le dernier à ${hm(err[0].debut)} : ${err[0].message || 'erreur inconnue'}`);
  const vu = de(code)[0];
  if (h >= 9 && h <= 22 && (!vu || depuis(vu.debut) > 2.5)) ajouter(code + '-silence', `${nom} ne donne plus signe de vie depuis ${vu ? hm(vu.debut) : '48 h'} : vérifie que son workflow est activé dans n8n.`);
}

// ---------- Ollama ----------
let ollama = true;
try { await this.helpers.httpRequest({ method: 'GET', url: R.OLLAMA_URL + '/api/tags', timeout: 5000, json: true }); }
catch (e) { ollama = false; ajouter('ollama', "Ollama ne répond pas : l'agent B ne pourra pas trier les offres. Lance Ollama sur le PC."); }

// ---------- Ne pas répéter une alerte déjà envoyée ----------
const dejaEnvoyees = new Set(de('G-controle').filter(r => depuis(r.debut) <= R.SILENCE_HEURES).flatMap(r => (r.details && r.details.envoyees) || []));
const nouvelles = alertes.filter(a => !dejaEnvoyees.has(a.cle));

// ---------- Rapport du jour ----------
const rapport = h === R.HEURE_RAPPORT && !de('G-controle').some(r => r.details && r.details.rapport && depuis(r.debut) < 12);
const r24 = runs.filter(r => depuis(r.debut) <= 24);
const somme = (ag, k) => r24.filter(r => r.agent === ag).reduce((s, r) => s + (r[k] || 0), 0);
const stats = {
  offres: somme('A-collecteur', 'sorties'), passagesA: r24.filter(r => r.agent === 'A-collecteur').length,
  envoyees: somme('B-tri', 'sorties'), clients: somme('B-tri', 'entrees'), erreurs: r24.filter(r => r.statut === 'erreur').length
};

let email = null;
const ligne = t => `<li style="margin:0 0 8px">${t}</li>`;
const pied = `<p style="color:#6b7280;font-size:13px;margin-top:24px">Agent G · contrôleur Lumen. Tableau de pilotage : https://visionary-sable-c9fb37.netlify.app/#agents</p>`;
if (nouvelles.length) {
  email = { to: R.EMAIL_ALERTE, subject: `⚠️ Lumen : ${nouvelles.length} problème${nouvelles.length > 1 ? 's' : ''} sur les agents`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><p>Bonjour,</p><p>Le contrôle de ${hm(now)} a relevé :</p><ul>${nouvelles.map(a => ligne(a.texte)).join('')}</ul>${pied}</div>` };
} else if (rapport) {
  email = { to: R.EMAIL_ALERTE, subject: `Lumen : rapport du ${now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><p>Bonjour,</p><p>Les dernières 24 heures :</p><ul>
      ${ligne(`<b>${stats.offres}</b> offres collectées en ${stats.passagesA} passages (agent A)`)}
      ${ligne(`<b>${stats.envoyees}</b> offres envoyées à ${stats.clients} client(s) (agent B)`)}
      ${ligne(`<b>${stats.erreurs}</b> exécution(s) en erreur`)}
      ${ligne(`Ollama : ${ollama ? 'en marche' : 'arrêté'}`)}
      ${alertes.length ? ligne('Problèmes en cours : ' + alertes.map(a => a.texte).join(' ')) : ligne('Aucun problème en cours.')}</ul>${pied}</div>` };
}

const journal = {
  agent: 'G-controle', debut: R.debut, fin: new Date().toISOString(), statut: alertes.length ? 'ok' : 'vide',
  entrees: 5, sorties: nouvelles.length,
  details: { alertes: alertes.map(a => a.texte), envoyees: nouvelles.map(a => a.cle), en_cours: alertes.length, ollama, rapport: !!(rapport && !nouvelles.length), stats },
  message: null
};
return [{ json: { email, a_envoyer: !!email, journal } }];
"""

nodes = [
    {"id": "g1", "name": "Toutes les heures (7 h – 22 h)", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "10 7-22 * * *"}]}}},
    code("g2", "Réglages", [220, 0], G_REGLAGES),
    sb_http("g3", "Lire le journal", [440, 0], "GET", S + "agent_runs?debut=gte.{{ $('Réglages').first().json.depuis }}&select=*&order=debut.desc&limit=2000"),
    {**code("g4", "Vérifier les agents", [660, 0], G_VERIFIER), "executeOnce": True},
    {"id": "g5", "name": "Alerte ou rapport ?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [880, -100],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
        "conditions": [{"id": "c1", "leftValue": "={{ $json.a_envoyer }}", "rightValue": True, "operator": {"type": "boolean", "operation": "equals"}}],
        "combinator": "and"}, "options": {}}},
    {"id": "g6", "name": "M'envoyer l'email", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [1100, -160], "continueOnFail": True,
     "credentials": {"smtp": {"id": "", "name": "Brevo SMTP"}},
     "parameters": {"fromEmail": "Lumen Pilotage <lumeniaindustrie@gmail.com>", "toEmail": "={{ $json.email.to }}", "subject": "={{ $json.email.subject }}",
                    "emailFormat": "html", "html": "={{ $json.email.html }}", "options": {"appendAttribution": False}}},
    sb_http("g7", "Écrire le journal", [880, 100], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json.journal) }}", prefer="return=minimal"),
]
C = lambda n: {"node": n, "type": "main", "index": 0}
conn = {
    "Toutes les heures (7 h – 22 h)": {"main": [[C("Réglages")]]},
    "Réglages": {"main": [[C("Lire le journal")]]},
    "Lire le journal": {"main": [[C("Vérifier les agents")]]},
    "Vérifier les agents": {"main": [[C("Alerte ou rapport ?"), C("Écrire le journal")]]},
    "Alerte ou rapport ?": {"main": [[C("M'envoyer l'email")], []]},
}
wf = {"name": "Lumen – Agent G : contrôleur", "nodes": nodes, "connections": conn, "settings": {"executionOrder": "v1"}, "pinData": {}}
json.dump(wf, open(os.path.join(OUT, "n8n_agent_G_controleur.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
open(os.path.join(OUT, "_chk_g.js"), "w").write("async function f(){" + G_REGLAGES + "}\nasync function g(){" + G_VERIFIER + "}")
print("ok")
