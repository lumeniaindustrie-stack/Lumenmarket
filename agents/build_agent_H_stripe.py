"""Génère l'agent H (abonnement Stripe) pour n8n en local.

Reçoit les évènements Stripe (paiement réussi, abonnement annulé) et met à jour
automatiquement le statut du client dans Supabase (profils.formule / .actif),
sans intervention manuelle. Journalise chaque évènement dans agent_runs,
comme les autres agents du projet.
"""
import json, os
from build_agents_local import sb_http, code, chain, SUPABASE_URL  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
S = SUPABASE_URL + "/rest/v1/"

LIRE_EVENEMENT = r"""
const body = $input.first().json.body || $input.first().json;
const type = body.type || '';
const obj = (body.data && body.data.object) || {};

let email = null, customer_id = obj.customer || null, action = 'ignorer';

if (type === 'checkout.session.completed' || type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
  email = ((obj.customer_details && obj.customer_details.email) || obj.customer_email || '').trim().toLowerCase() || null;
  action = 'activer';
} else if (type === 'customer.subscription.deleted') {
  action = 'desactiver';
}

return [{ json: { type, email, customer_id, action, recu: new Date().toISOString() } }];
"""

PREPARER_ACTIVATION = r"""
const j = $json;
const filtre = j.email ? 'email=ilike.' + encodeURIComponent(j.email)
             : (j.customer_id ? 'stripe_customer_id=eq.' + encodeURIComponent(j.customer_id) : null);
return [{ json: { ...j, filtre_valide: !!filtre,
  url: '""" + S + r"""profils?' + (filtre || ''),
  patch: { formule: 'abonne', actif: true, stripe_customer_id: j.customer_id, maj_le: new Date().toISOString() } } }];
"""

PREPARER_DESACTIVATION = r"""
const j = $json;
const filtre = j.customer_id ? 'stripe_customer_id=eq.' + encodeURIComponent(j.customer_id) : null;
return [{ json: { ...j, filtre_valide: !!filtre,
  url: '""" + S + r"""profils?' + (filtre || ''),
  patch: { actif: false, maj_le: new Date().toISOString() } } }];
"""

PREPARER_JOURNAL = r"""
const j = $json;
return [{ json: { journal: {
  agent: 'H-comptable', debut: j.recu, fin: new Date().toISOString(),
  statut: j.action === 'ignorer' ? 'vide' : 'ok',
  entrees: 1, sorties: j.action === 'ignorer' ? 0 : 1,
  details: { type: j.type, email: j.email, customer_id: j.customer_id, action: j.action },
  message: j.filtre_valide === false ? "évènement Stripe sans email ni customer_id : profil non mis à jour" : null
} } }];
"""

nodes = [
    {"id": "h1", "name": "Stripe : évènement reçu", "type": "n8n-nodes-base.stripeTrigger", "typeVersion": 1, "position": [0, 0],
     "parameters": {"events": ["checkout.session.completed", "invoice.paid", "customer.subscription.deleted"]},
     "credentials": {"stripeApi": {"id": "", "name": "Stripe Lumen"}}},
    code("h2", "Lire l'évènement", [220, 0], LIRE_EVENEMENT),
    {"id": "h3", "name": "Activer, désactiver ou ignorer ?", "type": "n8n-nodes-base.switch", "typeVersion": 3, "position": [440, 0],
     "parameters": {"rules": {"values": [
         {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "a", "leftValue": "={{ $json.action }}", "rightValue": "activer", "operator": {"type": "string", "operation": "equals"}}],
             "combinator": "and"}, "outputKey": "activer"},
         {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "d", "leftValue": "={{ $json.action }}", "rightValue": "desactiver", "operator": {"type": "string", "operation": "equals"}}],
             "combinator": "and"}, "outputKey": "desactiver"}]},
         "options": {"fallbackOutput": "extra"}}},
    code("h4", "Préparer l'activation", [660, -120], PREPARER_ACTIVATION),
    sb_http("h5", "Activer l'abonnement", [880, -120], "PATCH", "{{ $json.url }}", body_expr="={{ JSON.stringify($json.patch) }}", prefer="return=minimal"),
    code("h6", "Préparer la désactivation", [660, 60], PREPARER_DESACTIVATION),
    sb_http("h7", "Désactiver l'abonnement", [880, 60], "PATCH", "{{ $json.url }}", body_expr="={{ JSON.stringify($json.patch) }}", prefer="return=minimal"),
    {**code("h8", "Préparer le journal", [1100, 0], PREPARER_JOURNAL), "alwaysOutputData": True},
    sb_http("h9", "Écrire le journal", [1320, 0], "POST", S + "agent_runs", body_expr="={{ JSON.stringify($json.journal) }}", prefer="return=minimal"),
]

C = lambda n: {"node": n, "type": "main", "index": 0}
conn = {
    "Stripe : évènement reçu": {"main": [[C("Lire l'évènement")]]},
    "Lire l'évènement": {"main": [[C("Activer, désactiver ou ignorer ?")]]},
    "Activer, désactiver ou ignorer ?": {"main": [
        [C("Préparer l'activation")],
        [C("Préparer la désactivation")],
        [C("Préparer le journal")],
    ]},
    "Préparer l'activation": {"main": [[C("Activer l'abonnement")]]},
    "Activer l'abonnement": {"main": [[C("Préparer le journal")]]},
    "Préparer la désactivation": {"main": [[C("Désactiver l'abonnement")]]},
    "Désactiver l'abonnement": {"main": [[C("Préparer le journal")]]},
    "Préparer le journal": {"main": [[C("Écrire le journal")]]},
}

wf = {"name": "Lumen – Agent H : abonnement Stripe", "nodes": nodes, "connections": conn,
      "settings": {"executionOrder": "v1"}, "pinData": {}}
json.dump(wf, open(os.path.join(OUT, "n8n_agent_H_stripe.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
open(os.path.join(OUT, "_chk_h_stripe.js"), "w").write(
    "async function f(){" + LIRE_EVENEMENT + "}\n"
    "async function g(){" + PREPARER_ACTIVATION + "}\n"
    "async function k(){" + PREPARER_DESACTIVATION + "}\n"
    "async function m(){" + PREPARER_JOURNAL + "}"
)
print("ok")
