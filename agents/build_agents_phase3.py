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
CHEMIN_SCRIPTS = r"C:\Users\marin_3s4sfng\Desktop\Projet\Lumenmarket\Lument_agents"


def commande(dossier, script):
    return {"id": "cmd", "name": "Lancer le navigateur", "type": "n8n-nodes-base.executeCommand", "typeVersion": 1, "position": [220, 0],
            "parameters": {"command": f'node "{CHEMIN_SCRIPTS}\\{dossier}\\{script}"'}}


def journal(agent_code):
    return f"""
const sortie = $('Lancer le navigateur').first().json;
let r = {{ offres: [], total: 0, erreur: "Sortie du script illisible : " + String(sortie.stdout || '').slice(0, 200) }};
try {{ r = JSON.parse(sortie.stdout); }} catch (e) {{}}
if (sortie.exitCode && sortie.exitCode !== 0) r.erreur = r.erreur || ('Le script a échoué (code ' + sortie.exitCode + ') : ' + String(sortie.stderr || '').slice(0, 300));
return [{{ json: {{ debut: new Date().toISOString(), offres: r.offres || [], total: r.total || 0, erreur: r.erreur || null }} }}];
"""


def preparer_journal_agent(agent_code):
    # c.erreur peut être un échec total (aucune offre) ou partiel (ex. une région sur 14
    # a buté sur le site source) : on ne marque 'erreur' que quand rien n'a été collecté,
    # sinon 'ok' avec le message d'avertissement conservé pour garder trace du problème.
    return f"""
const c = $('Préparer le journal').first().json;
let statut = 'ok', message = null;
const erreurs = $input.all().map(i => i.json).filter(x => x && x.error);
if (erreurs.length) {{ statut = 'erreur'; message = 'Enregistrement dans Supabase impossible : ' + JSON.stringify(erreurs[0].error).slice(0, 300); }}
else if (c.erreur && !c.total) {{ statut = 'erreur'; message = c.erreur; }}
else if (c.erreur) {{ message = c.erreur; }}
else if (!c.total) statut = 'vide';
return [{{ json: {{ agent: '{agent_code}', debut: c.debut, fin: new Date().toISOString(), statut, entrees: c.total, sorties: statut === 'erreur' ? 0 : c.total, details: {{}}, message }} }}];
"""


def sous_agent(agent_code, nom_agent, dossier, script, heure):
    nodes = [
        {"id": "trig", "name": "Toutes les 24 heures", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": f"0 {heure} * * *"}]}}},
        {**commande(dossier, script), "position": [220, 0]},
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


AGENTS = [
    ("E1-place", "E1 : PLACE (marches-publics.gouv.fr)", "E1-place", "e1-place.js", 4, "n8n_agent_E1_place.json"),
    ("E2-aws", "E2 : AWS-Achat (marches-publics.info)", "E2-aws", "e2-aws.js", 5, "n8n_agent_E2_aws.json"),
    ("E3-emp", "E3 : e-marchespublics.com", "E3-emp", "e3-emp.js", 4, "n8n_agent_E3_emp.json"),
    ("E4-maximilien", "E4 : Maximilien (marches.maximilien.fr)", "E4-maximilien", "e4-maximilien.js", 6, "n8n_agent_E4_maximilien.json"),
    ("E5-klekoon", "E5 : Klekoon (klekoon.com)", "E5-klekoon", "e5-klekoon.js", 7, "n8n_agent_E5_klekoon.json"),
    ("E6-ebourgogne", "E6 : e-Bourgogne / Ternum BFC (marches.ternum-bfc.fr)", "E6-ebourgogne", "e6-ebourgogne.js", 8, "n8n_agent_E6_ebourgogne.json"),
    ("E7-megalis", "E7 : Mégalis Bretagne (marches.megalis.bretagne.bzh)", "E7-megalis", "e7-megalis.js", 9, "n8n_agent_E7_megalis.json"),
]

if __name__ == "__main__":
    for agent_code, nom, dossier, script, heure, fichier in AGENTS:
        wf = sous_agent(agent_code, nom, dossier, script, heure)
        with open(os.path.join(OUT, fichier), "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
        print(f"Écrit : {fichier}")
