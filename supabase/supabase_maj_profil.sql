-- =====================================================================
--  MISE À JOUR : questionnaire de première connexion
--  À coller dans Supabase > SQL Editor > New query > Run
--  (sans danger si on le relance)
-- =====================================================================
alter table public.profils
  add column if not exists siret              text,
  add column if not exists site_web           text,
  add column if not exists description        text,
  add column if not exists qualifications     text,
  add column if not exists effectif           text,
  add column if not exists ca_annuel          text,
  add column if not exists code_naf           text,
  add column if not exists ville              text,
  add column if not exists exclusions         text,
  add column if not exists references_clients text,
  add column if not exists marches_gagnes     text,
  add column if not exists onboarding_fait    boolean not null default false;

-- Limites de taille (protection contre les textes géants)
alter table public.profils drop constraint if exists profils_tailles;
alter table public.profils add constraint profils_tailles check (
  coalesce(length(description), 0) <= 2000 and coalesce(length(references_clients), 0) <= 2000
  and coalesce(length(marches_gagnes), 0) <= 4000
  and coalesce(length(site_web), 0) <= 300 and coalesce(length(qualifications), 0) <= 500
  and coalesce(length(exclusions), 0) <= 1000
);

-- Le client peut remplir ces informations lui-même
grant update (siret, site_web, description, qualifications, effectif, ca_annuel, code_naf, ville,
              exclusions, references_clients, marches_gagnes, onboarding_fait) on public.profils to authenticated;
