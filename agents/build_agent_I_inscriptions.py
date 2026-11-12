"""
Agent I — Alerte « nouveau client inscrit »

Toutes les 2 minutes : lit les comptes clients créés sur le site et pas encore
signalés (profils.alerte_admin_le vide), envoie un email au fondateur avec les
infos du client (réponse directe au client possible), puis les marque comme
signalés et écrit le journal.

Prérequis : supabase/supabase_alerte_inscription.sql exécuté dans Supabase.
Usage : python3 build_agent_I_inscriptions.py  ->  n8n_agent_I_inscriptions.json
"""
import json, os
from build_agents_local import sb_http, code, chain, SUPABASE_URL

S = SUPABASE_URL + "/rest/v1/"

PREPARER = r"""
// ===== RÉGLAGE =====
const EMAIL_ADMIN = 'marinsauzay991@gmail.com';   // qui reçoit l'alerte à chaque nouveau compte
const PILOTAGE = 'https://lumenmarket.pages.dev/#clients';
// ===================
const clients = $input.all().map(i => i.json).filter(p => p && p.id && p.email);
if (!clients.length) return [];
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const LOGO = 'https://lumen-marche.fr/logo-signature.png?v=2';
const date = s => s ? new Date(s).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }) : '';
const heure = s => s ? new Date(s).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : '';
const ligne = (k, v) => v ? `<tr><td style="padding:5px 14px 5px 0;color:#6B7280;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;color:#171A21;">${esc(v)}</td></tr>` : '';
const out = [];
for (const p of clients) {
  const nom = p.entreprise || p.nom || p.email;
  const zone = String(p.departements || '').trim() || 'Toute la France';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F6F7F9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;padding:28px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E6E8EC;">
<tr><td style="padding:22px 32px;border-bottom:1px solid #E6E8EC;"><img src="${LOGO}" width="180" height="29" alt="Lumen Marchés" style="display:block;border:0;width:180px;height:29px;"></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;color:#171A21;">
  <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#0E9F6E;text-transform:uppercase;letter-spacing:.04em;">Nouveau client inscrit</p>
  <p style="margin:0 0 18px;font-size:20px;font-weight:700;">${esc(nom)}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:20px;">
    ${ligne('Email', p.email)}${ligne('Email de réception', p.email_reception && p.email_reception !== p.email ? p.email_reception : '')}
    ${ligne('Téléphone', p.telephone)}${ligne('SIREN', p.siren)}
    ${ligne('Activités', p.metiers)}${ligne('Mots-clés', p.mots_cles)}${ligne('Zone', zone)}
    ${ligne('Inscrit le', date(p.cree_le) + ' à ' + heure(p.cree_le))}${ligne("Fin de l'essai", date(p.fin_essai))}
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#2350C4;">
    <a href="${PILOTAGE}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Voir dans le pilotage</a></td></tr></table>
  <p style="margin:18px 0 0;font-size:13px;color:#6B7280;">Répondez à cet email pour écrire directement au client.</p>
</td></tr></table></td></tr></table></body></html>`;
  out.push({ json: { id: p.id, to: EMAIL_ADMIN, replyTo: p.email, subject: `Nouveau client : ${nom}`, html } });
}
return out;
"""

JOURNAL = r"""
const clients = $('Lire les nouveaux comptes').all().map(i => i.json).filter(p => p && p.id);
const envois = $('Envoyer l\'alerte').all().map(i => i.json);
const erreurs = envois.filter(e => e && e.error).length;
return [{ json: { agent: 'I-inscriptions', debut: new Date(Date.now() - 60000).toISOString(), fin: new Date().toISOString(),
  statut: erreurs ? 'erreur' : 'ok', entrees: clients.length, sorties: envois.length - erreurs,
  details: { clients: clients.map(p => ({ id: p.id, entreprise: p.entreprise })), emails_en_erreur: erreurs },
  message: erreurs ? erreurs + ' alerte(s) non envoyée(s) : vérifier le credential Brevo SMTP. Elles seront retentées.' : null } }];
"""

# Ne marque « signalés » que les comptes dont l'email est vraiment parti (sinon nouvel essai 2 min plus tard)
MARQUER = r"""
const ok = $('Préparer l\'alerte').all().map((it, i) => ({ id: it.json.id, err: $('Envoyer l\'alerte').all()[i]?.json?.error }))
  .filter(x => x.id && !x.err).map(x => x.id);
return [{ json: { ids: ok.join(',') } }];
"""

nodes = [
    {"id": "i1", "name": "Toutes les 2 minutes", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "*/2 * * * *"}]}}},
    sb_http("i2", "Lire les nouveaux comptes", [220, 0], "GET",
            S + "profils?alerte_admin_le=is.null&est_admin=not.is.true&order=cree_le.asc&limit=20&select=*"),
    code("i3", "Préparer l'alerte", [440, 0], PREPARER),
    {"id": "i4", "name": "Envoyer l'alerte", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [660, 0], "continueOnFail": True,
     "credentials": {"smtp": {"id": "", "name": "Brevo SMTP"}},
     "parameters": {"fromEmail": "Lumen Marchés <lumeniaindustrie@gmail.com>", "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}",
                    "emailFormat": "html", "html": "={{ $json.html }}", "options": {"appendAttribution": False, "replyTo": "={{ $json.replyTo }}"}}},
    dict(code("i5", "Garder les alertes parties", [880, 0], MARQUER), executeOnce=True),
    sb_http("i6", "Marquer comme signalés", [1100, 0], "PATCH",
            S + "profils?id=in.({{ $json.ids || '00000000-0000-0000-0000-000000000000' }})",
            body_expr="={{ JSON.stringify({ alerte_admin_le: new Date().toISOString() }) }}", prefer="return=minimal"),
    code("i7", "Préparer le journal", [1320, 0], JOURNAL),
    sb_http("i8", "Écrire le journal", [1540, 0], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
]
wf = {"name": "Lumen – Agent I : alerte nouvelle inscription", "nodes": nodes,
      "connections": chain([n["name"] for n in nodes]), "settings": {"executionOrder": "v1"}, "active": False}
sortie = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n_agent_I_inscriptions.json")
json.dump(wf, open(sortie, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("écrit :", sortie)
