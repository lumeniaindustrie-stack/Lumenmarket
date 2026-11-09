"""Génère les agents C (chat client) et D (analyse des dossiers) pour n8n en local, avec Ollama."""
import json, os
from build_agents_local import sb_http, code, SUPABASE_URL, LIRE_MODELE_ACTIF  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
S = SUPABASE_URL + "/rest/v1/"
C = lambda n: {"node": n, "type": "main", "index": 0}
REGLAGES_IA = """
""" + LIRE_MODELE_ACTIF + """
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODELE = await modeleActif('qwen2.5:7b');  // modèle choisi dans l'onglet "Modèles IA" du pilotage
"""
SETTINGS = {"executionOrder": "v1", "saveDataSuccessExecution": "none", "saveManualExecutions": True}

def declencheur(id_, name, sec):
    return {"id": id_, "name": name, "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
            "parameters": {"rule": {"interval": [{"field": "seconds", "secondsInterval": sec}]}}}

def si(id_, name, pos, expr):
    return {"id": id_, "name": name, "type": "n8n-nodes-base.if", "typeVersion": 2, "position": pos,
            "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                "conditions": [{"id": "c1", "leftValue": "={{ " + expr + " }}", "rightValue": True, "operator": {"type": "boolean", "operation": "equals"}}],
                "combinator": "and"}, "options": {}}}

def une_fois(n):
    n["executeOnce"] = True
    return n

def battement(agent, sec):
    return f"""
// Une fois par heure, l'agent signale qu'il est en marche (pour le tableau de pilotage).
const d = new Date();
if (d.getMinutes() !== 0 || d.getSeconds() >= {sec}) return [];
return [{{ json: {{ agent: '{agent}', debut: d.toISOString(), fin: d.toISOString(), statut: 'vide', entrees: 0, sorties: 0, details: {{ battement: true }} }} }}];
"""

# =====================================================================
#  AGENT C : CHAT CLIENT
# =====================================================================
C_RECHERCHE = r"""
const m = $('Lire la file').first().json;
const p = $('Lire le profil').all().map(i => i.json).find(x => x && x.id) || {};
const VIDES = new Set('avec dans pour mais plus moins sont nous vous elle elles leur leurs cette ceci cela comme quoi quel quelle quels quelles offre offres marché marchés marche marches appel appels public publics avez avoir être faire peux peut pouvez bonjour merci autre autres entre depuis sans chez tout tous toute toutes très aussi donc alors encore combien quand comment pourquoi celle celui ceux semaine mois jour jours demain dossier dossiers réponse répondre'.split(' '));
const sansAccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
let mots = (String(m.contenu).toLowerCase().match(/[a-zàâäçéèêëîïôöùûüœ]{4,}/g) || []).filter(w => !VIDES.has(w) && !VIDES.has(sansAccent(w)));
if (!mots.length) mots = String((p.mots_cles || '') + ',' + (p.metiers || '')).toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(s => s.length > 3);
const formes = [...new Set(mots.slice(0, 5).flatMap(w => { const r = w.slice(0, Math.max(4, Math.min(w.length, 7))); return [r, sansAccent(r)]; }))];
const deps = String(p.departements || '').split(/[^0-9AB]+/i).map(s => s.trim()).filter(Boolean).map(d => d.length === 1 ? '0' + d : d);
let chemin = 'offres?select=avis_id,objet,acheteur,lieu,montant,limite,url,departements&order=limite.asc&limit=12'
  + '&limite=gt.' + encodeURIComponent(new Date().toISOString());
if (formes.length) chemin += '&or=(' + formes.map(f => 'objet.ilike.*' + encodeURIComponent(f.replace(/[,()*]/g, '')) + '*').join(',') + ')';
if (deps.length) chemin += '&departements=ov.' + encodeURIComponent('{' + deps.join(',') + '}');
return [{ json: { chemin, avis: encodeURIComponent(m.avis_id || 'aucun') } }];
"""

C_PREPARER = r"""
""" + REGLAGES_IA + r"""
const m = $('Lire la file').first().json;
const p = $('Lire le profil').all().map(i => i.json).find(x => x && x.id) || {};
const histo = $('Lire l\'historique').all().map(i => i.json).filter(x => x && x.contenu).reverse();
const envoyees = $('Lire les offres proposées').all().map(i => i.json).filter(x => x && x.avis_id);
const trouvees = $('Chercher dans les offres').all().map(i => i.json).filter(x => x && x.avis_id);
const citee = $('Lire l\'offre citée').all().map(i => i.json).find(x => x && x.avis_id);
const jj = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : 'non précisée';
const eur = n => n ? Math.round(Number(n)).toLocaleString('fr-FR') + ' €' : 'montant non communiqué';
const ligne = o => `- ${o.objet} | ${o.acheteur || 'acheteur ?'} | ${o.lieu || (o.departements || []).join(', ') || 'lieu ?'} | ${eur(o.montant)} | limite ${jj(o.limite)}${o.score ? ' | note ' + o.score + '/5' : ''}${o.resume ? ' | ' + o.resume : ''} | ${o.url}`;
const systeme = `Tu es l'assistant de Lumen Marchés, un service de veille des marchés publics. Tu aides l'entreprise "${p.entreprise || 'cliente'}" à trouver et choisir ses appels d'offres.
Aujourd'hui : ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
Profil : activité ${p.metiers || 'non précisée'} ; mots-clés ${p.mots_cles || 'aucun'} ; départements ${p.departements || 'non précisés'} ; présentation : ${String(p.description || 'non renseignée').slice(0, 600)} ; qualifications : ${p.qualifications || 'non renseignées'} ; effectif : ${p.effectif || '?'} ; exclusions : ${p.exclusions || 'aucune'}.
Règles :
- Réponds en français, simplement et brièvement (6 phrases au plus, ou une courte liste).
- Appuie-toi UNIQUEMENT sur les offres listées ci-dessous et sur le profil. N'invente jamais d'offre, de date, de montant ou de lien.
- Quand tu cites une offre, donne son objet, sa date limite et son lien.
- Si la réponse n'est pas dans ces informations, dis-le franchement et conseille d'ouvrir l'avis ou d'analyser le dossier dans l'espace (menu "Analyser un dossier").
- Tu ne peux pas déposer d'offre ni contacter l'acheteur à la place du client.
${citee ? '\nOFFRE DONT PARLE LE CLIENT :\n' + ligne(citee) + '\n' : ''}
OFFRES DÉJÀ PROPOSÉES AU CLIENT (récentes) :
${envoyees.map(ligne).join('\n') || 'aucune pour le moment'}

OFFRES OUVERTES TROUVÉES POUR SA QUESTION (dans sa zone) :
${trouvees.map(ligne).join('\n') || 'aucune trouvée avec ces mots'}`;
const messages = [{ role: 'system', content: systeme }]
  .concat(histo.slice(-8).map(h => ({ role: h.role === 'agent' ? 'assistant' : 'user', content: String(h.contenu).slice(0, 1200) })))
  .concat([{ role: 'user', content: String(m.contenu) }]);
return [{ json: { ollama: { model: MODELE, messages, stream: false, options: { num_ctx: 8192, temperature: 0.3 } }, OLLAMA_URL, debut: new Date().toISOString(), nb_offres: envoyees.length + trouvees.length } }];
"""

C_REPONSE = r"""
const m = $('Lire la file').first().json;
const prep = $('Préparer la question').first().json;
const r = $input.first().json || {};
let texte = String(r.message?.content || '').trim();
const ok = !!texte && !r.error;
if (!ok) texte = "Désolé, je n'arrive pas à répondre pour le moment. Réessayez dans quelques minutes : votre question est bien enregistrée.";
return [{ json: {
  reponse: { client_id: m.client_id, role: 'agent', contenu: texte.slice(0, 4000), avis_id: m.avis_id || null, statut: 'repondu' },
  statut_question: ok ? 'repondu' : 'erreur', id: m.id,
  journal: { agent: 'C-chat', debut: prep.debut, fin: new Date().toISOString(), statut: ok ? 'ok' : 'erreur', entrees: 1, sorties: ok ? 1 : 0,
             details: { offres_en_contexte: prep.nb_offres, modele: prep.ollama.model }, message: ok ? null : String(r.error?.message || r.error || 'Ollama ne répond pas').slice(0, 300) }
} }];
"""

c_nodes = [
    declencheur("c1", "Toutes les 15 secondes", 15),
    sb_http("c2", "Lire la file", [220, 0], "GET", S + "messages_chat?statut=eq.en_attente&role=eq.client&order=cree_le.asc&limit=1&select=*"),
    si("c3", "Une question ?", [440, 0], "!!$json.id"),
    code("c3b", "Battement", [660, 220], battement("C-chat", 15)),
    sb_http("c3c", "Signaler l'activité", [880, 220], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
    une_fois(sb_http("c4", "Marquer en cours", [660, -60], "PATCH", S + "messages_chat?id=eq.{{ $('Lire la file').first().json.id }}",
                     body_expr='={"statut":"en_cours"}', prefer="return=minimal")),
    une_fois(sb_http("c5", "Lire le profil", [880, -60], "GET", S + "profils?id=eq.{{ $('Lire la file').first().json.client_id }}&select=*")),
    une_fois(sb_http("c6", "Lire l'historique", [1100, -60], "GET",
                     S + "messages_chat?client_id=eq.{{ $('Lire la file').first().json.client_id }}&id=lt.{{ $('Lire la file').first().json.id }}&order=cree_le.desc&limit=8&select=role,contenu")),
    une_fois(sb_http("c7", "Lire les offres proposées", [1320, -60], "GET",
                     S + "offres_envoyees?client_id=eq.{{ $('Lire la file').first().json.client_id }}&order=date_envoi.desc&limit=20&select=avis_id,objet,acheteur,lieu,montant,limite,score,resume,url")),
    une_fois(code("c8", "Préparer la recherche", [1540, -60], C_RECHERCHE)),
    une_fois(sb_http("c9", "Chercher dans les offres", [1760, -60], "GET", S + "{{ $('Préparer la recherche').first().json.chemin }}")),
    une_fois(sb_http("c10", "Lire l'offre citée", [1980, -60], "GET", S + "offres?avis_id=eq.{{ $('Préparer la recherche').first().json.avis }}&select=avis_id,objet,acheteur,lieu,montant,limite,url,departements")),
    une_fois(code("c11", "Préparer la question", [2200, -60], C_PREPARER)),
    {"id": "c12", "name": "L'IA répond (Ollama)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [2420, -60],
     "continueOnFail": True, "alwaysOutputData": True, "executeOnce": True,
     "parameters": {"method": "POST", "url": "={{ $json.OLLAMA_URL }}/api/chat", "sendBody": True, "specifyBody": "json",
                    "jsonBody": "={{ JSON.stringify($json.ollama) }}", "options": {"timeout": 300000}}},
    une_fois(code("c13", "Lire la réponse", [2640, -60], C_REPONSE)),
    une_fois(sb_http("c14", "Écrire la réponse", [2860, -60], "POST", S + "messages_chat",
                     body_expr="={{ JSON.stringify($('Lire la réponse').first().json.reponse) }}", prefer="return=minimal")),
    une_fois(sb_http("c15", "Clore la question", [3080, -60], "PATCH", S + "messages_chat?id=eq.{{ $('Lire la réponse').first().json.id }}",
                     body_expr="={{ JSON.stringify({ statut: $('Lire la réponse').first().json.statut_question }) }}", prefer="return=minimal")),
    une_fois(sb_http("c16", "Écrire le journal", [3300, -60], "POST", S + "agent_runs",
                     body_expr="={{ JSON.stringify($('Lire la réponse').first().json.journal) }}", prefer="return=minimal")),
]
c_conn = {
    "Toutes les 15 secondes": {"main": [[C("Lire la file")]]},
    "Lire la file": {"main": [[C("Une question ?")]]},
    "Une question ?": {"main": [[C("Marquer en cours")], [C("Battement")]]},
    "Battement": {"main": [[C("Signaler l'activité")]]},
}
suite = ["Marquer en cours", "Lire le profil", "Lire l'historique", "Lire les offres proposées", "Préparer la recherche", "Chercher dans les offres",
         "Lire l'offre citée", "Préparer la question", "L'IA répond (Ollama)", "Lire la réponse", "Écrire la réponse", "Clore la question", "Écrire le journal"]
for a, b in zip(suite, suite[1:]):
    c_conn[a] = {"main": [[C(b)]]}
agent_c = {"name": "Lumen – Agent C : chat client (Ollama)", "nodes": c_nodes, "connections": c_conn, "settings": SETTINGS, "pinData": {}}

# =====================================================================
#  AGENT D : ANALYSE DES DOSSIERS
# =====================================================================
D_PREPARER = r"""
""" + REGLAGES_IA + r"""
const MAX = 50000;   // caractères de dossier lus par l'IA (le règlement de consultation passe en premier)
const a = $('Lire la file').first().json;
const c = $('Lire le profil').all().map(i => i.json).find(x => x && x.id) || {};
// On remet les pièces dans l'ordre utile : règlement, CCAP, acte d'engagement, CCTP, le reste.
const morceaux = String(a.texte || '').split(/(?=\n*===== FICHIER : )/).filter(s => s.trim());
const rang = s => { const t = (s.match(/FICHIER : ([^\n]*)/) || [, ''])[1].toLowerCase();
  return /r[eè]glement|\brc\b|_rc|rc[_ .-]/.test(t) ? 0 : /ccap/.test(t) ? 1 : /\bae\b|acte|engagement/.test(t) ? 2 : /cctp/.test(t) ? 3 : 4; };
let texte = morceaux.sort((x, y) => rang(x) - rang(y)).join('\n').replace(/[ \t]+/g, ' ');
const coupe = texte.length > MAX; if (coupe) texte = texte.slice(0, MAX);
const consignes = `Tu es un expert des marchés publics en France (travaux, services, fournitures). Analyse ce dossier de consultation (DCE) pour une PME.
Entreprise : ${c.entreprise || '?'}. Activité : ${c.metiers || '?'}. Départements d'intervention : ${c.departements || '?'}.
Présentation : ${String(c.description || 'non renseignée').slice(0, 600)}. Qualifications : ${c.qualifications || 'non renseignées'}. Effectif : ${c.effectif || '?'}. Chiffre d'affaires : ${c.ca_annuel || '?'}.
Marchés déjà remportés : ${String(c.marches_gagnes || 'aucun connu').slice(0, 800)}
Pour l'avis final, vérifie si l'entreprise a les qualifications, la taille et les références demandées.
Règles : réponds en français ; n'invente rien ; si une information est absente, écris "Non précisé dans le dossier" ; cite l'article (ex. "RC art. 6.1") quand il est identifiable.
Réponds uniquement avec un objet JSON de cette forme :
{"acheteur":"","objet":"","procedure":"","lots":[""],"date_limite":"","visite":"","duree":"","montant":"","criteres":[{"critere":"","poids":0}],"pieces":[{"piece":"","ref":""}],"risques":[{"niveau":"élevé|moyen|faible","point":"","explication":""}],"avis":{"decision":"On y va|À étudier|On passe","raison":""}}
"poids" est un nombre (pourcentage). Liste toutes les pièces demandées.`;
return [{ json: { OLLAMA_URL, debut: new Date().toISOString(), coupe, taille: texte.length,
  ollama: { model: MODELE, stream: false, format: 'json', options: { num_ctx: 20480, temperature: 0.1 },
    messages: [{ role: 'system', content: consignes }, { role: 'user', content: 'DOSSIER DE CONSULTATION :\n' + texte }] } } }];
"""

D_LIRE = r"""
const a = $('Lire la file').first().json;
const c = $('Lire le profil').all().map(i => i.json).find(x => x && x.id) || {};
const prep = $('Préparer l\'analyse').first().json;
const r = $input.first().json || {};
const brut = String(r.message?.content || '');
let analyse = null;
try { analyse = JSON.parse(brut.replace(/```json|```/g, '').trim()); } catch (e) { const m = brut.match(/\{[\s\S]*\}/); if (m) { try { analyse = JSON.parse(m[0]); } catch (e2) {} } }
const ok = !!(analyse && analyse.objet);
const fin = new Date().toISOString();
const tentatives = Number(a.tentatives || 0);
const reessai = !ok && tentatives < 1;          // premier échec : on relance une fois automatiquement
const maj = reessai ? { statut: 'en_attente', tentatives: tentatives + 1, message: null }
  : ok
  ? { statut: 'terminee', resultat: analyse, objet: String(analyse.objet).slice(0, 300), decision: String(analyse.avis?.decision || '').slice(0, 50), texte: null, message: prep.coupe ? 'Dossier très long : seules les premières pièces (règlement en priorité) ont été lues.' : null, termine_le: fin }
  : { statut: 'erreur', texte: null, termine_le: fin, message: r.error ? "L'agent d'analyse ne répond pas pour le moment. Relancez l'analyse dans quelques minutes." : "L'analyse n'a pas pu être mise en forme. Relancez-la, ou envoyez le dossier par email." };
const raison = String(r.error?.message || r.error || (brut ? 'réponse illisible : ' + brut.slice(0, 200) : 'réponse vide')).slice(0, 400);
return [{ json: { ok, reessai, prevenir: !ok && !reessai, id: a.id, maj, email: c.email, entreprise: c.entreprise, analyse, raison,
  journal: { agent: 'D-analyse', debut: prep.debut, fin, statut: ok ? 'ok' : 'erreur', entrees: 1, sorties: ok ? 1 : 0,
             details: { caracteres: prep.taille, coupe: prep.coupe, modele: prep.ollama.model, decision: ok ? analyse.avis?.decision : null },
             message: ok ? null : (reessai ? 'Échec, nouvel essai automatique : ' : 'Échec définitif : ') + raison.slice(0, 250) } } }];
"""

D_EMAIL = r"""
const j = $('Lire l\'analyse').first().json;
const a = j.analyse;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const li = arr => (arr || []).map(x => `<li>${x}</li>`).join('');
const html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#1a2433">
<p>Bonjour,</p>
<p>Voici l'analyse du dossier <b>${esc(a.objet)}</b> (${esc(a.acheteur)}).</p>
<p style="background:#14335a;color:#fff;padding:10px 14px;border-radius:4px"><b>Avis : ${esc(a.avis?.decision)}</b><br>${esc(a.avis?.raison)}</p>
<p><b>Date limite :</b> ${esc(a.date_limite)}<br><b>Visite :</b> ${esc(a.visite)}<br><b>Procédure :</b> ${esc(a.procedure)}<br><b>Durée :</b> ${esc(a.duree)}<br><b>Montant :</b> ${esc(a.montant)}</p>
<p><b>Critères de notation</b></p><ul>${li((a.criteres || []).map(c => esc(c.critere) + ' : ' + esc(c.poids) + ' %'))}</ul>
<p><b>Pièces à fournir</b></p><ul>${li((a.pieces || []).map(p => esc(p.piece) + (p.ref ? ' <span style="color:#566275">(' + esc(p.ref) + ')</span>' : '')))}</ul>
<p><b>Points à risque</b></p><ul>${li((a.risques || []).map(r => '<b>' + esc(r.point) + '</b> (risque ' + esc(r.niveau) + ') : ' + esc(r.explication)))}</ul>
<p>Retrouvez cette analyse dans votre espace, menu « Analyser un dossier ».</p>
<p>L'équipe Lumen<br>lumeniaindustrie@gmail.com, 06 50 93 85 52</p>
<p style="font-size:12px;color:#566275">Analyse produite par une IA : vérifiez les dates et les pièces dans le règlement de consultation avant de déposer votre offre.</p>
</div>`;
return [{ json: { to: j.email, subject: 'Analyse du dossier : ' + String(a.objet || '').slice(0, 90), html } }];
"""

D_ECHEC = r"""
const EMAIL_ADMIN = 'marinsauzay991@gmail.com';   // qui est prévenu quand une analyse échoue
const j = $('Lire l\'analyse').first().json;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const sortie = [{ json: { to: EMAIL_ADMIN, subject: `⚠️ Analyse échouée pour ${j.entreprise || 'un client'}`,
  html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>L'agent D n'a pas réussi à analyser le dossier n° ${j.id} de <b>${esc(j.entreprise)}</b> (${esc(j.email)}), même après un nouvel essai.</p><p>Raison : ${esc(j.raison)}</p><p>Le client voit un message d'échec dans son espace et a reçu un email. Pense à le recontacter.</p></div>` } }];
if (j.email) sortie.push({ json: { to: j.email, subject: "Votre analyse de dossier n'a pas abouti",
  html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a2433"><p>Bonjour,</p><p>Notre agent n'a pas réussi à analyser le dossier que vous avez déposé. Nous sommes prévenus et revenons vers vous rapidement.</p><p>En attendant, vous pouvez relancer l'analyse depuis votre espace, ou nous envoyer le dossier à lumeniaindustrie@gmail.com.</p><p>L'équipe Lumen<br>06 50 93 85 52</p></div>` } });
return sortie;
"""

d_nodes = [
    declencheur("d1", "Toutes les 20 secondes", 20),
    sb_http("d2", "Lire la file", [220, 0], "GET", S + "analyses?statut=eq.en_attente&order=cree_le.asc&limit=1&select=id,client_id,texte,tentatives"),
    si("d3", "Un dossier ?", [440, 0], "!!$json.id"),
    code("d3b", "Battement", [660, 220], battement("D-analyse", 20)),
    sb_http("d3c", "Signaler l'activité", [880, 220], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
    une_fois(sb_http("d4", "Marquer en cours", [660, -60], "PATCH", S + "analyses?id=eq.{{ $('Lire la file').first().json.id }}",
                     body_expr='={"statut":"en_cours"}', prefer="return=minimal")),
    une_fois(sb_http("d5", "Lire le profil", [880, -60], "GET", S + "profils?id=eq.{{ $('Lire la file').first().json.client_id }}&select=*")),
    une_fois(code("d6", "Préparer l'analyse", [1100, -60], D_PREPARER)),
    {"id": "d7", "name": "L'IA analyse (Ollama)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1320, -60],
     "continueOnFail": True, "alwaysOutputData": True, "executeOnce": True,
     "parameters": {"method": "POST", "url": "={{ $json.OLLAMA_URL }}/api/chat", "sendBody": True, "specifyBody": "json",
                    "jsonBody": "={{ JSON.stringify($json.ollama) }}", "options": {"timeout": 1800000}}},
    une_fois(code("d8", "Lire l'analyse", [1540, -60], D_LIRE)),
    une_fois(sb_http("d9", "Enregistrer l'analyse", [1760, -160], "PATCH", S + "analyses?id=eq.{{ $('Lire l\\'analyse').first().json.id }}",
                     body_expr="={{ JSON.stringify($('Lire l\\'analyse').first().json.maj) }}", prefer="return=minimal")),
    une_fois(sb_http("d10", "Écrire le journal", [1980, -160], "POST", S + "agent_runs",
                     body_expr="={{ JSON.stringify($('Lire l\\'analyse').first().json.journal) }}", prefer="return=minimal")),
    si("d11", "Analyse réussie ?", [1760, 40], "$json.ok"),
    une_fois(code("d12", "Préparer l'email", [1980, 20], D_EMAIL)),
    si("d14", "Échec définitif ?", [1980, 220], "$('Lire l\\'analyse').first().json.prevenir"),
    une_fois(code("d15", "Préparer les emails d'échec", [2200, 200], D_ECHEC)),
    {"id": "d16", "name": "Prévenir de l'échec", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [2420, 200], "continueOnFail": True,
     "credentials": {"smtp": {"id": "", "name": "Brevo SMTP"}},
     "parameters": {"fromEmail": "Lumen Marchés <lumeniaindustrie@gmail.com>", "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}",
                    "emailFormat": "html", "html": "={{ $json.html }}", "options": {"appendAttribution": False}}},
    {"id": "d13", "name": "Envoyer l'analyse au client", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [2200, 20], "continueOnFail": True,
     "credentials": {"smtp": {"id": "", "name": "Brevo SMTP"}},
     "parameters": {"fromEmail": "Lumen Marchés <lumeniaindustrie@gmail.com>", "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}",
                    "emailFormat": "html", "html": "={{ $json.html }}", "options": {"appendAttribution": False}}},
]
d_conn = {
    "Toutes les 20 secondes": {"main": [[C("Lire la file")]]},
    "Lire la file": {"main": [[C("Un dossier ?")]]},
    "Un dossier ?": {"main": [[C("Marquer en cours")], [C("Battement")]]},
    "Battement": {"main": [[C("Signaler l'activité")]]},
    "Marquer en cours": {"main": [[C("Lire le profil")]]},
    "Lire le profil": {"main": [[C("Préparer l'analyse")]]},
    "Préparer l'analyse": {"main": [[C("L'IA analyse (Ollama)")]]},
    "L'IA analyse (Ollama)": {"main": [[C("Lire l'analyse")]]},
    "Lire l'analyse": {"main": [[C("Enregistrer l'analyse"), C("Analyse réussie ?")]]},
    "Enregistrer l'analyse": {"main": [[C("Écrire le journal")]]},
    "Analyse réussie ?": {"main": [[C("Préparer l'email")], [C("Échec définitif ?")]]},
    "Échec définitif ?": {"main": [[C("Préparer les emails d'échec")], []]},
    "Préparer les emails d'échec": {"main": [[C("Prévenir de l'échec")]]},
    "Préparer l'email": {"main": [[C("Envoyer l'analyse au client")]]},
}
agent_d = {"name": "Lumen – Agent D : analyse des dossiers (Ollama)", "nodes": d_nodes, "connections": d_conn, "settings": SETTINGS, "pinData": {}}

json.dump(agent_c, open(os.path.join(OUT, "n8n_agent_C_chat.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(agent_d, open(os.path.join(OUT, "n8n_agent_D_analyse.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
for nm, js in [("echec", D_ECHEC), ("c_rech", C_RECHERCHE), ("c_prep", C_PREPARER), ("c_rep", C_REPONSE), ("d_prep", D_PREPARER), ("d_lire", D_LIRE), ("d_email", D_EMAIL), ("batt", battement("X", 15))]:
    open(os.path.join(OUT, f"_chk_{nm}.js"), "w").write("async function f(){" + js + "}")
print("ok")
