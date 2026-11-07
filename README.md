# Lumen Marchés

Veille des marchés publics triée par IA pour les PME.

| Dossier | Contenu | Mise en ligne |
|---|---|---|
| `site/` | Site public et espace client | Cloudflare Pages, projet `lumen-marches` (dossier de sortie : `site`) |
| `pilotage/` | Site d'administration (agents, clients, analytics) | Cloudflare Pages, projet `lumen-pilotage` (dossier de sortie : `pilotage`) |
| `agents/` | Workflows n8n des agents (A collecteur, B tri, C chat, D analyse, G contrôleur) et scripts qui les génèrent | À importer dans n8n |
| `supabase/` | Scripts SQL de la base, à lancer dans l'ordre : `supabase.sql`, `supabase_maj_profil.sql`, `supabase_phase1.sql`, `supabase_phase2.sql` | Supabase > SQL Editor |
| `windows/` | Démarrage automatique de n8n et Ollama sur le PC | `installer_lumen.ps1` |

Aucune clé secrète dans ce dépôt : seule la clé publique Supabase (faite pour être dans le navigateur) apparaît dans `config.js`. La clé `service_role` reste uniquement dans n8n.
