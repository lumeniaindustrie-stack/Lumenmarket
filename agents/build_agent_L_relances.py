"""
Agent L — Relance des prospects (une seule relance, 7 jours après le premier email de l'Agent K)

Du lundi au vendredi à 11 h 20 (après la fenêtre d'envoi de K, 9 h - 11 h) :
  - lit les entreprises contactées par K il y a au moins 7 jours, toujours au statut « envoyé »,
    jamais relancées, avec un email valide ;
  - écarte celles qui se sont inscrites sur Lumen (même SIREN) ;
  - envoie une relance courte, dans le même fil que le premier email (« Re: … », en-têtes In-Reply-To) ;
  - partage le plafond de 10 emails par jour avec K (relances = 10 - envois de K - relances déjà faites) ;
  - note relance_le et écrit le journal.

Pour qu'une entreprise ne soit PAS relancée (elle a répondu, dit STOP, n'est pas intéressée…) :
changer son statut dans Supabase (table entreprises) : tout statut autre que « envoyé » bloque la relance.

Prérequis : supabase/supabase_relances.sql exécuté dans Supabase.
Usage : python3 build_agent_L_relances.py  ->  n8n_agent_L_relances.json
"""
import json, os
from build_agents_local import sb_http, code, SUPABASE_URL

S = SUPABASE_URL + "/rest/v1/"

PREPARER = r"""
// ===== RÉGLAGES =====
const PLAFOND_JOUR = 10;          // emails de prospection par jour, K et L confondus
const SITE = 'https://lumen-marche.fr/', INSCRIPTION = SITE + 'inscription.html';
const LEGAL = 'Lumen IA, SIRET 985 215 474 00018, 205 chemin de la Halte, 13090 Aix-en-Provence · lumeniaindustrie@gmail.com';
// ====================
const tous = n => { try { return $(n).all().map(i => i.json).filter(x => x && Object.keys(x).length && !x.error); } catch (e) { return []; } };
const leads = tous('Lire les relances à faire').filter(l => l.siret && l.email);
const envoisK = tous('Compter les envois K du jour').length;
const relancesJour = tous('Compter les relances du jour').length;
const inscrits = new Set(tous('Lire les SIREN inscrits').map(p => String(p.siren || '').trim()).filter(Boolean));
const offres = new Map(tous('Lire les offres citées').map(o => [String(o.avis_id), o]));
const restantes = Math.max(0, PLAFOND_JOUR - envoisK - relancesJour);

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const jourTxt = s => { const t = new Date(s); if (!s || isNaN(t)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(t).map(x => [x.type, x.value]));
  return { jour: `${Number(p.day)} ${MOIS[Number(p.month) - 1]}`, complet: `${Number(p.day)} ${MOIS[Number(p.month) - 1]} ${p.year}` + ((Number(p.hour) % 24) || Number(p.minute) ? ` à ${Number(p.hour) % 24} h${Number(p.minute) ? ' ' + String(p.minute).padStart(2, '0') : ''}` : '') }; };
const PETITS = new Set(['de', 'du', 'des', 'et', 'en', 'sur', 'aux']);
const SIGLES = new Set(['sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop', 'sel', 'selarl', 'btp', 'tp', 'vrd', 'gie', 'ets', 'cvc']);
const joli = s => { s = String(s || '').trim(); if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/(\s+|-|'|’)/).map((w, i) => !/[a-zà-ÿ]/.test(w) ? w : SIGLES.has(w) ? w.toUpperCase() : (i && PETITS.has(w)) ? w : (i > 1 && w.length === 1) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(''); };
const typo = s => String(s || '')
  .replace(/\bma[iî]trise d['’]\s?oeuvre\b/gi, m => (m[0] === 'M' ? 'M' : 'm') + 'aîtrise d’œuvre')
  .replace(/\bma[iî]tre d['’]\s?oeuvre\b/gi, m => (m[0] === 'M' ? 'M' : 'm') + 'aître d’œuvre')
  .replace(/\bOeuvre/g, 'Œuvre').replace(/\boeuvre/g, 'œuvre').replace(/\bmaitrise\b/g, 'maîtrise').replace(/\bMaitrise\b/g, 'Maîtrise')
  .replace(/\bbatiment/g, 'bâtiment').replace(/\bBatiment/g, 'Bâtiment');
const court = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; };
const maj = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ignores = [], out = [];
for (const l of leads) {
  if (l.siren && inscrits.has(String(l.siren))) { ignores.push({ siret: l.siret, nom: l.nom, raison: 'déjà inscrit sur Lumen' }); continue; }
  if (out.length >= restantes) { ignores.push({ siret: l.siret, nom: l.nom, raison: 'plafond du jour atteint, relance demain' }); continue; }
  const prenom = l.dirigeant ? joli(String(l.dirigeant).split(/\s+/)[0].toUpperCase()) : '';
  const co = joli(l.nom) || 'votre entreprise';
  const o = offres.get(String(l.offre_id || '')) || null;
  const phrase = t => { t = String(t || '').trim(); return t && t === t.toUpperCase() ? maj(t.toLowerCase()) : t; };
  const titre = o ? typo(court(phrase(o.objet), 110)) : '';
  const acheteur = o ? maj(typo(joli(o.acheteur))) : '';
  const ouverte = o && o.limite && new Date(o.limite) > new Date(Date.now() + 2 * 864e5);
  const lim = o ? jourTxt(o.limite) : null;
  const envoye = jourTxt(l.date_envoi);
  const sujet = l.objet_email ? (/^re\s*:/i.test(l.objet_email) ? l.objet_email : 'Re: ' + l.objet_email) : `Re: ${prenom ? prenom + ', u' : 'U'}ne consultation publique pour ${co}`;

  const p1 = titre
    ? `Je me permets de revenir vers vous au sujet de mon message du ${envoye.jour}, à propos de la consultation « ${titre} »${acheteur ? ` (${acheteur})` : ''}.`
    : `Je me permets de revenir vers vous au sujet de mon message du ${envoye.jour} sur les marchés publics.`;
  const p2 = !o ? '' : ouverte
    ? `Elle est toujours ouverte : la date limite de réponse est fixée au ${lim.complet}.`
    : `Cette consultation arrive à son terme, mais des marchés de ce type sont publiés chaque semaine.`;
  const p3 = `Lumen vous envoie chaque matin les appels d’offres publics qui correspondent à votre métier et à votre zone, triés et résumés par notre IA. Vous pouvez l’essayer gratuitement pendant 14 jours, sans carte bancaire.`;
  const p4 = `Si ce n’est pas le bon moment, dites-le-moi simplement : je ne vous relancerai pas.`;
  const bonjour = prenom ? `Bonjour ${prenom},` : 'Bonjour,';

  const texte = [bonjour, '', p1, p2, ouverte && o.url ? 'Voir l’avis : ' + o.url : '', '', p3, 'Essayer Lumen : ' + INSCRIPTION, '', p4, '',
    'Bien cordialement,', 'Marin Sauzay', 'Fondateur de Lumen Marchés', SITE, '', 'Pour ne plus recevoir de messages de Lumen, répondez simplement « STOP ».', LEGAL]
    .filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  const P = t => `<p style="margin:0 0 14px;">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#171A21;background:#FFFFFF;">
<div style="max-width:600px;">
${P(esc(bonjour))}
${P(esc(p1) + (p2 ? ' ' + esc(p2) : '') + (ouverte && o.url ? ` <a href="${esc(o.url)}" style="color:#2350C4;">Voir l’avis</a>` : ''))}
${P(esc(p3) + ` <a href="${INSCRIPTION}" style="color:#2350C4;font-weight:700;">Essayer Lumen gratuitement</a>`)}
${P(esc(p4))}
<p style="margin:0 0 18px;">Bien cordialement,<br><b>Marin Sauzay</b><br>Fondateur de Lumen Marchés<br><a href="${SITE}" style="color:#2350C4;">lumen-marche.fr</a></p>
<p style="margin:0;font-size:12px;color:#6B7280;">Pour ne plus recevoir de messages de Lumen, répondez simplement « STOP ».</p>
<p style="margin:6px 0 0;font-size:11px;color:#9CA3AF;">${esc(LEGAL)}</p>
</div></body></html>`;
  const corps = { sender: { name: 'Marin Sauzay — Lumen', email: 'marin@lumen-marche.fr' },
    replyTo: { email: 'lumeniaindustrie@gmail.com', name: 'Marin Sauzay — Lumen' },
    to: [{ email: l.email, name: l.dirigeant || co }], bcc: [{ email: 'lumeniaindustrie@gmail.com' }],
    subject: sujet, htmlContent: html, textContent: texte, tags: ['lumen-relance-l'] };
  if (l.brevo_message_id) corps.headers = { 'In-Reply-To': l.brevo_message_id, 'References': l.brevo_message_id };
  out.push({ json: { action: 'send', siret: l.siret, nom: co, email: l.email, offre: titre || null, brevo: corps } });
}
const resume = { leads: leads.length, envoisK, relancesJour, restantes, ignores };
if (!out.length) return [{ json: { action: 'rien', resume } }];
out[0].json.resume = resume;
return out;
"""

JOURNAL = r"""
const prep = $('Préparer les relances').all().map(i => i.json);
const resume = prep[0]?.resume || {};
let envois = [];
try { envois = $('Envoyer la relance').all().map(i => i.json); } catch (e) {}
const aEnvoyer = prep.filter(p => p.action === 'send');
const ok = envois.filter(e => e && e.messageId).length;
const erreurs = aEnvoyer.length - ok;
const derniere = envois.find(e => e && e.error);
const ign = resume.ignores || [];
let message;
if (!aEnvoyer.length) message = resume.leads ? `Aucune relance envoyée : ${ign.map(i => i.raison).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.` : 'Aucune entreprise à relancer aujourd’hui.';
else message = `${ok} relance(s) envoyée(s)` + (erreurs ? `, ${erreurs} en erreur (${String(derniere?.error?.message || derniere?.error || '').slice(0, 120)})` : '') + (ign.length ? `. ${ign.length} reportée(s) ou écartée(s).` : '.');
return [{ json: { agent: 'L-relances', debut: new Date(Date.now() - 60000).toISOString(), fin: new Date().toISOString(),
  statut: erreurs && !ok ? 'erreur' : ok ? 'ok' : 'vide', entrees: resume.leads || 0, sorties: ok,
  details: { plafond_restant: resume.restantes, envois_k_du_jour: resume.envoisK, relances: aEnvoyer.map(p => ({ siret: p.siret, nom: p.nom, offre: p.offre })), ignores: ign },
  message } }];
"""

DEBUT_JOUR = "{{ $now.setZone('Europe/Paris').startOf('day').toUTC().toISO() }}"

def once(n):
    n["executeOnce"] = True
    return n

nodes = [
    {"id": "l1", "name": "Lun-ven à 11 h 20", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "20 11 * * 1-5"}]}}},
    once(sb_http("l2", "Lire les relances à faire", [220, 0], "GET",
            S + "entreprises?select=siret,siren,nom,dirigeant,email,offre_id,objet_email,brevo_message_id,date_envoi"
                "&statut=eq.envoy%C3%A9&relance_le=is.null&email_valide=eq.true"
                "&date_envoi=lt.{{ $now.minus({days:7}).toUTC().toISO() }}&order=date_envoi.asc&limit=30")),
    once(sb_http("l3", "Compter les envois K du jour", [440, 0], "GET", S + "entreprises?select=siret&date_envoi=gte." + DEBUT_JOUR + "&limit=1000")),
    once(sb_http("l4", "Compter les relances du jour", [660, 0], "GET", S + "entreprises?select=siret&relance_le=gte." + DEBUT_JOUR + "&limit=1000")),
    once(sb_http("l5", "Lire les SIREN inscrits", [880, 0], "GET", S + "profils?select=siren&siren=not.is.null&limit=5000")),
    once(sb_http("l6", "Lire les offres citées", [1100, 0], "GET",
            S + "offres?select=avis_id,objet,acheteur,limite,url&avis_id=in.({{ $('Lire les relances à faire').all().map(i => i.json.offre_id).filter(Boolean).map(v => '\"' + String(v).replace(/\"/g, '') + '\"').join(',') || '\"aucune\"' }})")),
    code("l7", "Préparer les relances", [1320, 0], PREPARER),
    {"id": "l8", "name": "Relance à envoyer ?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [1540, 0],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "typeValidation": "loose"}, "combinator": "and",
        "conditions": [{"id": "c1", "leftValue": "={{ $json.action }}", "rightValue": "send", "operator": {"type": "string", "operation": "equals"}}]}, "options": {}}},
    {"id": "l9", "name": "Envoyer la relance", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1760, -100],
     "continueOnFail": True, "alwaysOutputData": True,
     "credentials": {"httpHeaderAuth": {"id": "", "name": "Brevo API Header Auth"}},
     "parameters": {"method": "POST", "url": "https://api.brevo.com/v3/smtp/email", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "Content-Type", "value": "application/json"}, {"name": "accept", "value": "application/json"}]},
        "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.brevo) }}", "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": 4000}}}}},
    sb_http("l10", "Noter la relance", [1980, -100], "PATCH",
            S + "entreprises?siret=eq.{{ $('Préparer les relances').item.json.siret }}",
            body_expr="={{ JSON.stringify($json.messageId ? { relance_le: $now.toISO(), relance_message_id: $json.messageId } : {}) }}", prefer="return=minimal"),
    once(code("l11", "Préparer le journal", [2200, 0], JOURNAL)),
    once(sb_http("l12", "Écrire le journal", [2420, 0], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal")),
]
names = [n["name"] for n in nodes]
conn = {}
for a, b in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (8, 9), (9, 10), (10, 11)]:
    conn.setdefault(names[a], {"main": [[]]})["main"][0].append({"node": names[b], "type": "main", "index": 0})
conn[names[7]] = {"main": [[{"node": names[8], "type": "main", "index": 0}], [{"node": names[10], "type": "main", "index": 0}]]}
wf = {"name": "Lumen – Agent L : relance des prospects", "nodes": nodes, "connections": conn,
      "settings": {"executionOrder": "v1", "timezone": "Europe/Paris"}, "active": False}
sortie = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n_agent_L_relances.json")
json.dump(wf, open(sortie, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("écrit :", sortie)
