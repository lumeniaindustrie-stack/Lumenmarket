"""
Agent M — Rappels d'abonnement (essai, nouvel abonné, résiliation)

Du lundi au vendredi à 10 h :
  - clients en essai : rappel à J-1 avant la fin de l'essai, puis à J+0, J+3, J+7, J+14 et J+20 après ;
    un seul rappel par étape et par client (table rappels_abonnement). Si une étape tombe un week-end,
    elle part le lundi (rattrapage jusqu'à 3 jours) ; on n'envoie jamais deux rappels le même jour.
  - nouvel abonné : un email de remerciement (une fois), qui rappelle qu'on peut te joindre rapidement ;
  - abonné qui résilie (Agent H met actif = false) : un code promo -50 % pendant 1 an (une fois).
  - un client avec profils.rappels_stop = true ne reçoit plus rien.

Prérequis : supabase/supabase_rappels_abonnement.sql exécuté ; dans Stripe, un code promo PROMO_CODE
(-50 %, durée 12 mois) et l'option « Autoriser les codes promotionnels » sur le lien de paiement.
Usage : python3 build_agent_M_abonnements.py  ->  n8n_agent_M_abonnements.json
"""
import json, os
from build_agents_local import sb_http, code, SUPABASE_URL

S = SUPABASE_URL + "/rest/v1/"

PREPARER = r"""
// ===== RÉGLAGES =====
const STRIPE = 'https://buy.stripe.com/28E9AU6KN6jxbHl5tncbC01';   // lien de paiement 49 € HT / mois
const PROMO_CODE = 'REVIENS50';                                     // code Stripe : -50 % pendant 12 mois
const PRIX = 49;
const SITE = 'https://lumen-marche.fr/', ESPACE = SITE + 'tableau.html';
const CONTACT = 'lumeniaindustrie@gmail.com';
const LOGO = 'https://lumen-marche.fr/logo-email.png?v=3';
const LEGAL = 'Lumen IA, SIRET 985 215 474 00018, 205 chemin de la Halte, 13090 Aix-en-Provence · lumeniaindustrie@gmail.com';
// ====================
const tous = n => { try { return $(n).all().map(i => i.json).filter(x => x && Object.keys(x).length && !x.error); } catch (e) { return []; } };
const clients = tous('Lire les clients').filter(c => c.id && (c.email || c.email_veille));
const deja = new Set(tous('Lire les rappels envoyés').map(r => r.client_id + '|' + r.type));
const nbOffres = {}, nbTop = {};
for (const o of tous('Lire les offres envoyées')) { nbOffres[o.client_id] = (nbOffres[o.client_id] || 0) + 1; if (Number(o.score) >= 4) nbTop[o.client_id] = (nbTop[o.client_id] || 0) + 1; }

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const ymdParis = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const aujourdhui = ymdParis(new Date());
const ecart = finEssai => Math.round((Date.parse(aujourdhui + 'T00:00:00Z') - Date.parse(String(finEssai).slice(0, 10) + 'T00:00:00Z')) / 864e5);
const dateTxt = ymd => { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return `${d} ${MOIS[m - 1]}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ETAPES = [['J-1', -1], ['J+0', 0], ['J+3', 3], ['J+7', 7], ['J+14', 14], ['J+20', 20]];
const RATTRAPAGE = 3;   // une étape manquée (week-end) part au plus 3 jours après

function gabarit({ titre, paragraphes, bouton, lien, apres = [], stop = true }) {
  const P = t => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#171A21;">${t}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6F7F9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;padding:28px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E6E8EC;">
<tr><td style="padding:22px 32px;border-bottom:1px solid #E6E8EC;"><img src="${LOGO}" width="196" height="41" alt="Lumen Marchés" style="display:block;border:0;width:196px;height:41px;"></td></tr>
<tr><td style="padding:28px 32px 8px;">
  <p style="margin:0 0 18px;font-size:20px;line-height:1.35;font-weight:700;color:#171A21;">${esc(titre)}</p>
  ${paragraphes.map(P).join('\n  ')}
  ${bouton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td style="border-radius:8px;background:#2350C4;">
    <a href="${esc(lien)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">${esc(bouton)}</a></td></tr></table>` : ''}
  ${apres.map(P).join('\n  ')}
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#171A21;">Bien cordialement,<br><b>Marin Sauzay</b><br>Fondateur de Lumen Marchés<br><a href="${SITE}" style="color:#2350C4;">lumen-marche.fr</a></p>
</td></tr>
<tr><td style="padding:16px 32px 22px;border-top:1px solid #E6E8EC;">
  ${stop ? '<p style="margin:0;font-size:12px;color:#6B7280;">Pour ne plus recevoir ces rappels, répondez simplement « STOP ».</p>' : ''}
  <p style="margin:6px 0 0;font-size:11px;color:#9CA3AF;">${esc(LEGAL)}</p>
</td></tr></table></td></tr></table></body></html>`;
}
const enTexte = ({ titre, paragraphes, bouton, lien, apres = [], stop = true }) => [titre, '', ...paragraphes.map(p => p.replace(/<[^>]+>/g, '')), '', bouton ? bouton + ' : ' + lien : '', '',
  ...apres.map(p => p.replace(/<[^>]+>/g, '')), '', 'Bien cordialement,', 'Marin Sauzay', 'Fondateur de Lumen Marchés', SITE, '', stop ? 'Pour ne plus recevoir ces rappels, répondez simplement « STOP ».' : '', LEGAL]
  .filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');

function contenu(type, c) {
  const n = nbOffres[c.id] || 0, top = nbTop[c.id] || 0, email = c.email || c.email_veille;
  const abo = STRIPE + '?prefilled_email=' + encodeURIComponent(email);
  const bilan = n ? `Pendant votre essai, Lumen vous a envoyé <b>${n} offre${n > 1 ? 's' : ''}</b> correspondant à votre activité${top ? `, dont ${top} jugée${top > 1 ? 's' : ''} très pertinente${top > 1 ? 's' : ''}` : ''}.` : '';
  const prix = `L’abonnement est à ${PRIX} € HT par mois, sans engagement : un email suffit pour arrêter.`;
  const question = `Une question avant de vous décider ? Répondez simplement à cet email, je vous réponds rapidement.`;
  const fin = dateTxt(c.fin_essai);
  switch (type) {
    case 'J-1': return { sujet: 'Votre essai Lumen se termine demain', titre: 'Votre essai gratuit se termine demain',
      paragraphes: [`Bonjour,`, `L’essai gratuit de Lumen pour <b>${esc(c.entreprise)}</b> se termine demain, le ${fin}.`, bilan, `Pour continuer à recevoir vos offres chaque matin à 9 h, il suffit de vous abonner. ${prix}`].filter(Boolean),
      bouton: 'Continuer avec Lumen', lien: abo, apres: [question] };
    case 'J+0': return { sujet: 'Votre essai Lumen est terminé', titre: 'Votre essai est terminé, vos offres sont en pause',
      paragraphes: [`Bonjour,`, `L’essai gratuit de <b>${esc(c.entreprise)}</b> s’est terminé le ${fin}. Vos offres quotidiennes sont mises en pause, mais votre compte et vos réglages sont conservés.`, bilan, `Abonnez-vous pour les reprendre dès demain matin. ${prix}`].filter(Boolean),
      bouton: 'Reprendre mes offres', lien: abo, apres: [question] };
    case 'J+3': return { sujet: 'Vos appels d’offres continuent d’être publiés', titre: 'De nouveaux marchés sont publiés chaque jour',
      paragraphes: [`Bonjour,`, `Depuis la fin de votre essai, de nouveaux appels d’offres correspondant à l’activité de <b>${esc(c.entreprise)}</b> sont publiés chaque jour sur le BOAMP et les plateformes des acheteurs.`, `Avec Lumen, vous les recevez triés et résumés chaque matin, et vous pouvez faire analyser les dossiers de consultation par notre IA. ${prix}`],
      bouton: 'Reprendre mes offres', lien: abo, apres: [question] };
    case 'J+7': return { sujet: 'Une question sur Lumen ?', titre: 'Votre avis compte',
      paragraphes: [`Bonjour,`, `Votre essai de Lumen s’est terminé il y a une semaine et je voulais savoir ce que vous en avez pensé.`, `Les offres n’étaient pas assez ciblées ? Le prix ne convient pas ? Il vous manque une fonction ? Répondez en une ligne à cet email : je lis tout et j’ajuste vos réglages si besoin.`],
      bouton: 'M’abonner à Lumen', lien: abo, apres: [prix] };
    case 'J+14': return { sujet: 'Toujours intéressé par les marchés publics ?', titre: 'Toujours intéressé par les marchés publics ?',
      paragraphes: [`Bonjour,`, `Si répondre à des marchés publics fait toujours partie de vos projets pour <b>${esc(c.entreprise)}</b>, Lumen peut vous faire gagner plusieurs heures de recherche par semaine : les offres de votre métier et de votre zone, chaque matin, résumées par l’IA.`, prix],
      bouton: 'Reprendre mes offres', lien: abo, apres: [question] };
    case 'J+20': return { sujet: 'Dernier message de notre part', titre: 'Dernier message de notre part',
      paragraphes: [`Bonjour,`, `C’est le dernier rappel que je vous envoie au sujet de votre essai Lumen : je ne vous écrirai plus à ce sujet.`, `Votre compte reste ouvert. Si vous souhaitez reprendre vos offres un jour, il vous suffira de vous abonner depuis votre espace ou avec le bouton ci-dessous.`],
      bouton: 'Reprendre mes offres', lien: abo, apres: [`Merci d’avoir essayé Lumen, et bonne continuation.`] };
    case 'merci': return { sujet: 'Merci pour votre confiance', titre: 'Bienvenue parmi les abonnés Lumen', stop: false,
      paragraphes: [`Bonjour,`, `Merci d’avoir choisi Lumen pour <b>${esc(c.entreprise)}</b>. Votre abonnement est actif : vos offres continuent d’arriver chaque matin à 9 h, du lundi au vendredi.`,
        `Besoin d’ajuster vos métiers, vos mots-clés ou votre zone ? Vous pouvez tout modifier depuis votre espace client.`],
      bouton: 'Ouvrir mon espace', lien: ESPACE,
      apres: [`<b>Une question, un besoin, une offre à analyser en urgence ?</b> Répondez directement à cet email ou écrivez à <a href="mailto:${CONTACT}" style="color:#2350C4;">${CONTACT}</a> : je vous réponds rapidement, en général dans la journée.`] };
    case 'promo50': return { sujet: '-50 % pendant 1 an pour revenir sur Lumen', titre: 'Votre abonnement est arrêté : -50 % pendant 1 an si vous revenez', stop: true,
      paragraphes: [`Bonjour,`, `Votre abonnement Lumen pour <b>${esc(c.entreprise)}</b> a bien été arrêté. Merci de nous avoir fait confiance.`,
        `Si vous souhaitez reprendre, je vous propose <b>50 % de réduction pendant 12 mois</b>, soit ${(PRIX / 2).toLocaleString('fr-FR', { minimumFractionDigits: PRIX % 2 ? 2 : 0 })} € HT par mois au lieu de ${PRIX} €, avec le code <b>${PROMO_CODE}</b> (déjà appliqué avec le bouton ci-dessous).`],
      bouton: 'Revenir à -50 %', lien: abo + '&prefilled_promo_code=' + encodeURIComponent(PROMO_CODE),
      apres: [`Et si quelque chose ne vous convenait pas, dites-le-moi en répondant à cet email : votre retour m’aide à améliorer Lumen.`] };
  }
}

const out = [], journal = [];
for (const c of clients) {
  let type = null;
  if (['abonne', 'accompagnement'].includes(c.formule)) {
    if (c.actif !== false && !deja.has(c.id + '|merci')) type = 'merci';
    else if (c.actif === false && !deja.has(c.id + '|promo50')) type = 'promo50';
  } else if (c.formule === 'essai' && c.fin_essai) {
    const j = ecart(c.fin_essai);
    const dues = ETAPES.filter(([, off]) => off <= j);
    const derniere = dues[dues.length - 1];
    const plusTardEnvoyee = ETAPES.some(([t, off]) => off > (derniere ? derniere[1] : -99) && deja.has(c.id + '|' + t));
    if (derniere && !deja.has(c.id + '|' + derniere[0]) && !plusTardEnvoyee && j - derniere[1] <= RATTRAPAGE) type = derniere[0];
  }
  if (!type) continue;
  const m = contenu(type, c);
  const email = c.email || c.email_veille;
  out.push({ json: { action: 'send', client_id: c.id, type, entreprise: c.entreprise, email,
    brevo: { sender: { name: 'Marin Sauzay — Lumen', email: 'marin@lumen-marche.fr' }, replyTo: { email: CONTACT, name: 'Marin Sauzay — Lumen' },
      to: [{ email, name: c.entreprise || email }], subject: m.sujet, htmlContent: gabarit(m), textContent: enTexte(m), tags: ['lumen-rappel-m', 'lumen-rappel-' + type] } } });
}
const resume = { clients: clients.length, a_envoyer: out.map(o => ({ entreprise: o.json.entreprise, type: o.json.type })) };
if (!out.length) return [{ json: { action: 'rien', resume } }];
out[0].json.resume = resume;
return out;
"""

GARDER = r"""
// Ne note que les rappels réellement partis (sinon ils seront retentés au prochain passage)
const prep = $('Préparer les rappels').all().map(i => i.json).filter(p => p.action === 'send');
const env = $('Envoyer le rappel').all().map(i => i.json);
const lignes = prep.map((p, i) => ({ client_id: p.client_id, type: p.type, brevo_message_id: env[i]?.messageId || null })).filter(l => l.brevo_message_id);
return [{ json: { lignes } }];
"""

JOURNAL = r"""
const prep = $('Préparer les rappels').all().map(i => i.json);
const resume = prep[0]?.resume || {};
let env = []; try { env = $('Envoyer le rappel').all().map(i => i.json); } catch (e) {}
const aEnvoyer = prep.filter(p => p.action === 'send');
const ok = env.filter(e => e && e.messageId).length, ko = aEnvoyer.length - ok;
const err = env.find(e => e && e.error);
const parType = aEnvoyer.reduce((a, p) => (a[p.type] = (a[p.type] || 0) + 1, a), {});
return [{ json: { agent: 'M-abonnements', debut: new Date(Date.now() - 60000).toISOString(), fin: new Date().toISOString(),
  statut: ko && !ok ? 'erreur' : ok ? 'ok' : 'vide', entrees: resume.clients || 0, sorties: ok,
  details: { par_type: parType, envois: resume.a_envoyer || [] },
  message: !aEnvoyer.length ? 'Aucun rappel à envoyer aujourd’hui.' : `${ok} email(s) envoyé(s) (${Object.entries(parType).map(([t, n]) => t + ' : ' + n).join(', ')})` + (ko ? `, ${ko} en erreur (${String(err?.error?.message || err?.error || '').slice(0, 120)}) : retentés demain.` : '.') } }];
"""

def once(n):
    n["executeOnce"] = True
    return n

nodes = [
    {"id": "m1", "name": "Lun-ven à 10 h", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 10 * * 1-5"}]}}},
    once(sb_http("m2", "Lire les clients", [220, 0], "GET",
            S + "profils?select=id,email,email_veille,entreprise,formule,actif,fin_essai,cree_le&est_admin=not.is.true&rappels_stop=not.is.true&limit=5000")),
    once(sb_http("m3", "Lire les rappels envoyés", [440, 0], "GET", S + "rappels_abonnement?select=client_id,type&limit=20000")),
    once(sb_http("m4", "Lire les offres envoyées", [660, 0], "GET",
            S + "offres_envoyees?select=client_id,score&date_envoi=gte.{{ $now.minus({days:45}).toFormat('yyyy-MM-dd') }}&limit=50000")),
    code("m5", "Préparer les rappels", [880, 0], PREPARER),
    {"id": "m6", "name": "Rappel à envoyer ?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [1100, 0],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "typeValidation": "loose"}, "combinator": "and",
        "conditions": [{"id": "c1", "leftValue": "={{ $json.action }}", "rightValue": "send", "operator": {"type": "string", "operation": "equals"}}]}, "options": {}}},
    {"id": "m7", "name": "Envoyer le rappel", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1320, -100],
     "continueOnFail": True, "alwaysOutputData": True,
     "credentials": {"httpHeaderAuth": {"id": "", "name": "Brevo API Header Auth"}},
     "parameters": {"method": "POST", "url": "https://api.brevo.com/v3/smtp/email", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "Content-Type", "value": "application/json"}, {"name": "accept", "value": "application/json"}]},
        "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.brevo) }}", "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": 2000}}}}},
    once(code("m8", "Garder les rappels partis", [1540, -100], GARDER)),
    once(sb_http("m9", "Noter les rappels", [1760, -100], "POST", S + "rappels_abonnement?on_conflict=client_id,type",
            body_expr="={{ JSON.stringify($json.lignes) }}", prefer="resolution=ignore-duplicates,return=minimal")),
    once(code("m10", "Préparer le journal", [1980, 0], JOURNAL)),
    once(sb_http("m11", "Écrire le journal", [2200, 0], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal")),
]
names = [n["name"] for n in nodes]
conn = {}
for a, b in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (6, 7), (7, 8), (8, 9), (9, 10)]:
    conn.setdefault(names[a], {"main": [[]]})["main"][0].append({"node": names[b], "type": "main", "index": 0})
conn[names[5]] = {"main": [[{"node": names[6], "type": "main", "index": 0}], [{"node": names[9], "type": "main", "index": 0}]]}
wf = {"name": "Lumen – Agent M : rappels d'abonnement", "nodes": nodes, "connections": conn,
      "settings": {"executionOrder": "v1", "timezone": "Europe/Paris"}, "active": False}
sortie = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n_agent_M_abonnements.json")
json.dump(wf, open(sortie, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("écrit :", sortie)
