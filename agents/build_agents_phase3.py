"""Génère les agents E (pôle prospection, phase 3) : coordinateur + sous-agents plateformes.

Contrairement à l'agent A (API ouverte du BOAMP), ces plateformes renvoient une page
vide à toute requête HTTP classique et n'affichent la vraie liste qu'à un navigateur
qui a réellement soumis le formulaire. Chaque sous-agent pilote donc un script
Playwright (dossier agents/scrapers/) via un nœud "Execute Command", au lieu d'un
appel HTTP direct comme l'agent A.
"""
import json, os
from build_agents_local import sb_http, code, chain, SUPABASE_URL

OUT = os.path.dirname(os.path.abspath(__file__))
S = SUPABASE_URL + "/rest/v1/"

# Chemin du script sur TON PC : à corriger pour qu'il pointe vers ton dossier Lumenmarket.
CHEMIN_REPO = r"C:\Lumenmarket"


def commande(script):
    return {"id": "cmd", "name": "Lancer le navigateur", "type": "n8n-nodes-base.executeCommand", "typeVersion": 1, "position": [220, 0],
            "parameters": {"command": f'node "{CHEMIN_REPO}\\agents\\scrapers\\{script}"'}}


def journal(agent_code):
    return f"""
const sortie = $('Lancer le navigateur').first().json;
let r = {{ offres: [], total: 0, erreur: "Sortie du script illisible : " + String(sortie.stdout || '').slice(0, 200) }};
try {{ r = JSON.parse(sortie.stdout); }} catch (e) {{}}
if (sortie.exitCode && sortie.exitCode !== 0) r.erreur = r.erreur || ('Le script a échoué (code ' + sortie.exitCode + ') : ' + String(sortie.stderr || '').slice(0, 300));
return [{{ json: {{ debut: new Date().toISOString(), offres: r.offres || [], total: r.total || 0, erreur: r.erreur || null }} }}];
"""


def preparer_journal_agent(agent_code):
    return f"""
const c = $('Préparer le journal').first().json;
let statut = 'ok', message = null;
const erreurs = $input.all().map(i => i.json).filter(x => x && x.error);
if (c.erreur) {{ statut = 'erreur'; message = c.erreur; }}
else if (erreurs.length) {{ statut = 'erreur'; message = 'Enregistrement dans Supabase impossible : ' + JSON.stringify(erreurs[0].error).slice(0, 300); }}
else if (!c.total) statut = 'vide';
return [{{ json: {{ agent: '{agent_code}', debut: c.debut, fin: new Date().toISOString(), statut, entrees: c.total, sorties: statut === 'erreur' ? 0 : c.total, details: {{}}, message }} }}];
"""


def sous_agent(agent_code, nom_agent, script, heure):
    nodes = [
        {"id": "trig", "name": "Toutes les 24 heures", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": f"0 {heure} * * *"}]}}},
        {**commande(script), "position": [220, 0]},
        code("prep", "Préparer le journal", [440, 0], journal(agent_code)),
        sb_http("ecrire", "Enregistrer les offres", [660, 0], "POST", S + "offres?on_conflict=avis_id",
                body_expr="={{ JSON.stringify($json.offres) }}", prefer="resolution=merge-duplicates,return=minimal"),
        code("prep2", "Préparer le journal agent", [880, 0], preparer_journal_agent(agent_code)),
        sb_http("jrn", "Écrire le journal", [1100, 0], "POST", S + "agent_runs",
                body_expr="={{ JSON.stringify($json) }}", prefer="return=minimal"),
    ]
    connexions = chain([n["name"] for n in nodes])
    return {"name": f"Lumen – Agent {nom_agent}", "nodes": nodes, "connections": connexions,
            "settings": {"executionOrder": "v1"}, "pinData": {}}


if __name__ == "__main__":
    e2 = sous_agent("E2-aws", "E2 : AWS-Achat (marches-publics.info)", "e2-aws.js", 5)
    with open(os.path.join(OUT, "n8n_agent_E2_aws.json"), "w", encoding="utf-8") as f:
        json.dump(e2, f, ensure_ascii=False, indent=2)
    print("Écrit : n8n_agent_E2_aws.json")
