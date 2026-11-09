-- =====================================================================
--  LUMEN MARCHÉS : base de données Supabase
--  À coller en une fois dans Supabase > SQL Editor > New query > Run
--
--  Sécurité :
--  - Les mots de passe sont gérés par Supabase Auth (chiffrés, jamais visibles).
--  - Chaque table a la "Row Level Security" activée : un client connecté
--    ne peut lire QUE ses propres lignes.
--  - Un client ne peut pas modifier sa formule, son statut ni sa fin d'essai.
--  - Seuls les agents n8n (clé "service_role", gardée dans n8n) écrivent
--    les offres envoyées, les analyses et les demandes.
-- =====================================================================

-- ---------- 1. Profils des clients (une ligne par compte) ----------
create table if not exists public.profils (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  entreprise    text not null,
  siren         text,
  telephone     text,
  metiers       text,
  mots_cles     text,
  departements  text,
  types         text not null default 'TRAVAUX, SERVICES, FOURNITURES',
  montant_min   integer,
  formule       text not null default 'essai' check (formule in ('essai', 'abonne', 'accompagnement')),
  actif         boolean not null default true,
  fin_essai     date not null default (current_date + 7),
  notes_admin   text,                                   -- tes notes internes, invisibles pour le client
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now()
);
comment on table public.profils is 'Un compte client Lumen Marchés. Le mot de passe est dans auth.users (chiffré).';

-- ---------- 2. Offres envoyées par l'agent de veille ----------
create table if not exists public.offres_envoyees (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references public.profils(id) on delete cascade,
  date_envoi   date not null default current_date,
  avis_id      text not null,
  objet        text not null,
  acheteur     text,
  departement  text,
  lieu         text,
  montant      numeric,
  limite       timestamptz,
  score        smallint,
  resume       text,
  url          text,
  unique (client_id, avis_id)
);
create index if not exists offres_envoyees_client_date on public.offres_envoyees (client_id, date_envoi desc);

-- ---------- 3. Dossiers analysés ----------
create table if not exists public.analyses (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.profils(id) on delete cascade,
  cree_le    timestamptz not null default now(),
  objet      text,
  decision   text
);
create index if not exists analyses_client on public.analyses (client_id, cree_le desc);

-- ---------- 4. Offres suivies (calendrier du client) ----------
create table if not exists public.offres_suivies (
  client_id  uuid not null references public.profils(id) on delete cascade default auth.uid(),
  avis_id    text not null,
  donnees    jsonb not null,
  cree_le    timestamptz not null default now(),
  primary key (client_id, avis_id)
);

-- ---------- 5. Demandes "agents sur mesure" et "accompagnement" ----------
create table if not exists public.demandes (
  id          bigint generated always as identity primary key,
  cree_le     timestamptz not null default now(),
  offre       text not null,
  entreprise  text,
  nom         text,
  email       text not null,
  telephone   text,
  taille      text,
  rappel      text,
  outils      text,
  besoin      text not null,
  statut      text not null default 'à rappeler'
);

-- ---------- Création automatique du profil à l'inscription ----------
-- Le site envoie les infos du formulaire dans les "métadonnées" du compte ;
-- cette fonction les recopie dans la table profils, avec des limites de taille.
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profils (id, email, entreprise, siren, telephone, metiers, mots_cles, departements, types, montant_min)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(m->>'entreprise'), ''), 'Entreprise sans nom'), 200),
    case when m->>'siren' ~ '^[0-9]{9}$' then m->>'siren' end,
    left(m->>'telephone', 30),
    left(m->>'metiers', 500),
    left(m->>'mots_cles', 1500),
    left(m->>'departements', 200),
    coalesce(nullif(left(m->>'types', 60), ''), 'TRAVAUX, SERVICES, FOURNITURES'),
    case when m->>'montant_min' ~ '^[0-9]{1,9}$' then (m->>'montant_min')::integer end
  );
  return new;
end;
$$;

drop trigger if exists apres_inscription on auth.users;
create trigger apres_inscription
  after insert on auth.users
  for each row execute function public.creer_profil();

-- Date de mise à jour automatique
create or replace function public.maj_date()
returns trigger language plpgsql set search_path = '' as $$
begin new.maj_le := now(); return new; end; $$;
drop trigger if exists profils_maj on public.profils;
create trigger profils_maj before update on public.profils
  for each row execute function public.maj_date();

-- ---------- Sécurité : Row Level Security ----------
alter table public.profils          enable row level security;
alter table public.offres_envoyees  enable row level security;
alter table public.analyses         enable row level security;
alter table public.offres_suivies   enable row level security;
alter table public.demandes         enable row level security;

-- On retire tous les droits par défaut, puis on donne seulement le nécessaire.
revoke all on public.profils, public.offres_envoyees, public.analyses, public.offres_suivies, public.demandes from anon, authenticated;

-- Profil : le client lit son profil et ne modifie que ses informations de veille.
grant select on public.profils to authenticated;
grant update (entreprise, siren, telephone, metiers, mots_cles, departements, types, montant_min) on public.profils to authenticated;
drop policy if exists "profil : lecture" on public.profils;
create policy "profil : lecture" on public.profils for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profil : modification" on public.profils;
create policy "profil : modification" on public.profils for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Offres envoyées et analyses : lecture seule de ses propres lignes.
grant select on public.offres_envoyees, public.analyses to authenticated;
drop policy if exists "offres envoyées : lecture" on public.offres_envoyees;
create policy "offres envoyées : lecture" on public.offres_envoyees for select to authenticated using ((select auth.uid()) = client_id);
drop policy if exists "analyses : lecture" on public.analyses;
create policy "analyses : lecture" on public.analyses for select to authenticated using ((select auth.uid()) = client_id);

-- Offres suivies : le client gère sa propre liste.
grant select, insert, delete on public.offres_suivies to authenticated;
drop policy if exists "suivies : lecture" on public.offres_suivies;
create policy "suivies : lecture" on public.offres_suivies for select to authenticated using ((select auth.uid()) = client_id);
drop policy if exists "suivies : ajout" on public.offres_suivies;
create policy "suivies : ajout" on public.offres_suivies for insert to authenticated with check ((select auth.uid()) = client_id);
drop policy if exists "suivies : retrait" on public.offres_suivies;
create policy "suivies : retrait" on public.offres_suivies for delete to authenticated using ((select auth.uid()) = client_id);

-- Demandes : aucun accès depuis le site (seul l'agent n8n y écrit).

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

-- ---------- Vue pour toi : tous les clients avec leurs chiffres ----------
-- Visible dans Table Editor. security_invoker : la vue respecte la sécurité,
-- un client ne verrait que sa propre ligne ; toi (tableau Supabase) tu vois tout.
create or replace view public.vue_clients with (security_invoker = true) as
select
  p.entreprise, p.email, p.telephone, p.siren, p.metiers, p.departements, p.types, p.montant_min,
  p.siret, p.site_web, p.ville, p.effectif, p.ca_annuel, p.qualifications, p.description,
  p.formule, p.actif, p.fin_essai, p.cree_le, p.onboarding_fait,
  u.email_confirmed_at is not null as email_confirme,
  u.last_sign_in_at as derniere_connexion,
  (select count(*) from public.offres_envoyees o where o.client_id = p.id) as offres_recues,
  (select count(*) from public.analyses a where a.client_id = p.id) as dossiers_analyses,
  p.notes_admin, p.id
from public.profils p
join auth.users u on u.id = p.id;
revoke all on public.vue_clients from anon, authenticated;
