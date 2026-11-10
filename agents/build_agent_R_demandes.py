"""
Agent R — Réception des demandes « agents sur mesure » et « diagnostic IA »

Toutes les 2 minutes : lit les nouvelles demandes déposées par le formulaire du site
(table demandes, notifie_le vide), envoie un email au fondateur avec tous les détails
(réponse directe au client possible), un accusé de réception au client, puis marque
les demandes comme traitées et écrit le journal.

Usage : python3 build_agent_R_demandes.py  ->  n8n_agent_R_demandes.json
"""
import json, os
from build_agents_local import sb_http, code, chain, SUPABASE_URL

S = SUPABASE_URL + "/rest/v1/"

PREPARER = r"""
// ===== RÉGLAGE =====
const EMAIL_ADMIN = 'marinsauzay991@gmail.com';   // qui reçoit les nouvelles demandes
// ===================
const demandes = $input.all().map(i => i.json).filter(d => d && d.id && d.email);
if (!demandes.length) return [];
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const LOGO = 'https://lumen-marches.pages.dev/logo-signature.png';
const LIB = { diagnostic: 'Diagnostic IA sur place (300 € HT)', agents: 'Agents IA sur mesure', accompagnement: 'Accompagnement personnalisé (500 € HT)' };
const ligne = (k, v) => v ? `<tr><td style="padding:5px 12px 5px 0;color:#6B7280;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;color:#171A21;">${esc(v)}</td></tr>` : '';
const cadre = (contenu) => `<!doctype html><html><body style="margin:0;padding:0;background:#F6F7F9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;padding:28px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E6E8EC;">
<tr><td style="padding:22px 32px;border-bottom:1px solid #E6E8EC;"><img src="${LOGO}" width="130" height="40" alt="Lumen Marchés" style="display:block;border:0;width:130px;height:40px;"></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;color:#171A21;">${contenu}</td></tr>
<tr><td style="background:#F6F7F9;padding:16px 32px;border-top:1px solid #E6E8EC;"><p style="margin:0;font-size:12px;color:#6B7280;">Lumen IA, SIRET 985 215 474 00018 · lumeniaindustrie@gmail.com · 06 50 93 85 52</p></td></tr>
</table></td></tr></table></body></html>`;
const out = [];
for (const d of demandes) {
  const quoi = LIB[d.offre] || d.offre;
  // 1. Pour toi : tous les détails ; « Répondre » écrit directement au client
  out.push({ json: { to: EMAIL_ADMIN, replyTo: d.email, subject: `Nouvelle demande : ${quoi} — ${d.entreprise || d.nom || d.email}`,
    html: cadre(`<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#2350C4;text-transform:uppercase;letter-spacing:.04em;">Nouvelle demande</p>
      <p style="margin:0 0 18px;font-size:18px;font-weight:700;">${esc(quoi)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:18px;">
        ${ligne('Entreprise', d.entreprise)}${ligne('Nom', d.nom)}${ligne('Email', d.email)}${ligne('Téléphone', d.telephone)}
        ${ligne('Taille', d.taille)}${ligne('À rappeler', d.rappel || 'Indifférent')}${ligne('Outils', d.outils)}</table>
      <p style="margin:0 0 6px;font-weight:700;">Ce qu'il veut automatiser</p>
      <p style="margin:0 0 18px;background:#F6F7F9;border-radius:8px;padding:12px 14px;white-space:pre-wrap;">${esc(d.besoin)}</p>
      <p style="margin:0;font-size:13px;color:#6B7280;">Répondez à cet email pour écrire directement au client. Demande n° ${esc(d.id)}, visible dans le pilotage (onglet Demandes).</p>`) } });
  // 2. Pour le client : accusé de réception
  const prenom = String(d.nom || '').trim().split(/\s+/)[0];
  out.push({ json: { to: d.email, replyTo: 'lumeniaindustrie@gmail.com', subject: d.offre === 'diagnostic' ? 'Votre demande de diagnostic IA est bien reçue' : 'Votre demande est bien reçue',
    html: cadre(`<p style="margin:0 0 16px;">Bonjour${prenom ? ' ' + esc(prenom) : ''},</p>
      <p style="margin:0 0 16px;">Merci pour votre demande${d.offre === 'diagnostic' ? ' de <b>diagnostic IA sur place (300 € HT)</b>' : ''}. Nous l'avons bien reçue et nous vous recontactons rapidement${d.rappel ? ', de préférence ' + esc(String(d.rappel).toLowerCase()) : ''}, au ${esc(d.telephone || 'numéro indiqué')}.</p>
      ${d.offre === 'diagnostic' ? `<p style="margin:0 0 16px;">Lors de cet échange, nous fixerons ensemble la date de passage de l'ingénieur dans vos locaux et les tâches à observer en priorité.</p>` : `<p style="margin:0 0 16px;">Lors de cet échange, nous préciserons votre besoin pour vous proposer une solution chiffrée, sans engagement.</p>`}
      <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">Votre message :</p>
      <p style="margin:0 0 18px;background:#F6F7F9;border-radius:8px;padding:12px 14px;font-size:14px;white-space:pre-wrap;">${esc(d.besoin)}</p>
      <p style="margin:0;">Bien cordialement,<br><b>Marin Sauzay</b><br>Fondateur de Lumen</p>`) } });
}
return out;
"""

JOURNAL = r"""
const demandes = $('Lire les nouvelles demandes').all().map(i => i.json).filter(d => d && d.id);
const envois = $('Envoyer les emails').all().map(i => i.json);
const erreurs = envois.filter(e => e && e.error).length;
return [{ json: { agent: 'R-demandes', debut: new Date(Date.now() - 60000).toISOString(), fin: new Date().toISOString(),
  statut: erreurs ? (erreurs === envois.length ? 'erreur' : 'ok') : 'ok', entrees: demandes.length, sorties: envois.length - erreurs,
  details: { demandes: demandes.map(d => ({ id: d.id, offre: d.offre })), emails_en_erreur: erreurs },
  message: erreurs ? erreurs + ' email(s) non envoyé(s) : vérifier le credential Brevo SMTP.' : null } }];
"""

nodes = [
    {"id": "r1", "name": "Toutes les 2 minutes", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "*/2 * * * *"}]}}},
    sb_http("r2", "Lire les nouvelles demandes", [220, 0], "GET", S + "demandes?notifie_le=is.null&order=cree_le.asc&limit=20&select=*"),
    code("r3", "Préparer les emails", [440, 0], PREPARER),
    {"id": "r4", "name": "Envoyer les emails", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [660, 0], "continueOnFail": True,
     "credentials": {"smtp": {"id": "", "name": "Brevo SMTP"}},
     "parameters": {"fromEmail": "Lumen Marchés <lumeniaindustrie@gmail.com>", "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}",
                    "emailFormat": "html", "html": "={{ $json.html }}", "options": {"appendAttribution": False, "replyTo": "={{ $json.replyTo }}"}}},
    dict(sb_http("r5", "Marquer comme traitées", [880, 0], "PATCH",
                 S + "demandes?id=in.({{ $('Lire les nouvelles demandes').all().map(i => i.json.id).filter(Boolean).join(',') }})",
                 body_expr="={{ JSON.stringify({ notifie_le: new Date().toISOString() }) }}", prefer="return=minimal"), executeOnce=True),
    code("r6", "Préparer le journal", [1100, 0], JOURNAL),
    sb_http("r7", "Écrire le journal", [1320, 0], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
]
wf = {"name": "Lumen – Agent R : réception des demandes (sur mesure, diagnostic)", "nodes": nodes,
      "connections": chain([n["name"] for n in nodes]), "settings": {"executionOrder": "v1"}, "active": False}
sortie = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n_agent_R_demandes.json")
json.dump(wf, open(sortie, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("écrit :", sortie)
