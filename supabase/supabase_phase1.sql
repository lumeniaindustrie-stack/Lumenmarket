-- =====================================================================
--  PHASE 1 : offres collectées, journal des agents, accès administrateur
--  À coller dans Supabase > SQL Editor > New query > Run (sans danger si relancé)
-- =====================================================================

-- ---------- Toutes les offres publiques collectées par l'agent A ----------
create table if not exists public.offres (
  avis_id       text primary key,
  objet         text not null,
  acheteur      text,
  departements  text[],
  lieu          text,
  type_marche   text,
  procedure     text,
  descripteurs  text,
  montant       numeric,
  duree_mois    integer,
  nb_lots       integer,
  parution      date,
  limite        timestamptz,
  url           text,
  collecte_le   timestamptz not null default now()
);
create index if not exists offres_parution on public.offres (parution desc);
create index if not exists offres_limite on public.offres (limite);
create index if not exists offres_departements on public.offres using gin (departements);

-- ---------- Journal des agents (une ligne par exécution) ----------
create table if not exists public.agent_runs (
  id        bigint generated always as identity primary key,
  agent     text not null,          -- ex. 'A-collecteur', 'B-tri'
  debut     timestamptz not null default now(),
  fin       timestamptz,
  statut    text not null default 'ok' check (statut in ('ok', 'vide', 'erreur', 'en_cours')),
  entrees   integer default 0,      -- ce que l'agent a reçu (avis lus, clients traités…)
  sorties   integer default 0,      -- ce qu'il a produit (offres stockées, offres envoyées…)
  details   jsonb,                  -- chiffres complémentaires
  message   text                    -- explication en cas d'erreur
);
create index if not exists agent_runs_agent_debut on public.agent_runs (agent, debut desc);

-- ---------- Administrateur ----------
alter table public.profils add column if not exists est_admin boolean not null default false;

-- Fonction utilisée par les règles : l'utilisateur connecté est-il administrateur ?
create or replace function public.est_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select est_admin from public.profils where id = (select auth.uid())), false);
$$;
revoke all on function public.est_admin() from public;
grant execute on function public.est_admin() to authenticated;

-- Sécurité
alter table public.offres enable row level security;
alter table public.agent_runs enable row level security;
revoke all on public.offres, public.agent_runs from anon, authenticated;

-- Les offres sont des données publiques : tout client connecté peut les lire (recherche, chat).
grant select on public.offres to authenticated;
drop policy if exists "offres : lecture clients" on public.offres;
create policy "offres : lecture clients" on public.offres for select to authenticated using (true);

-- Journal des agents : administrateur seulement.
grant select on public.agent_runs to authenticated;
drop policy if exists "journal : admin" on public.agent_runs;
create policy "journal : admin" on public.agent_runs for select to authenticated using ((select public.est_admin()));

-- L'administrateur lit tout (profils, offres envoyées, analyses, demandes).
grant select on public.demandes to authenticated;
drop policy if exists "profils : admin" on public.profils;
create policy "profils : admin" on public.profils for select to authenticated using ((select public.est_admin()));
drop policy if exists "envoyees : admin" on public.offres_envoyees;
create policy "envoyees : admin" on public.offres_envoyees for select to authenticated using ((select public.est_admin()));
drop policy if exists "analyses : admin" on public.analyses;
create policy "analyses : admin" on public.analyses for select to authenticated using ((select public.est_admin()));
drop policy if exists "demandes : admin" on public.demandes;
create policy "demandes : admin" on public.demandes for select to authenticated using ((select public.est_admin()));

-- ---------- Ménage automatique : on garde 120 jours d'offres ----------
-- (à lancer de temps en temps, ou automatiquement par l'agent A)
create or replace function public.nettoyer_offres()
returns integer language sql security definer set search_path = '' as $$
  with s as (delete from public.offres where parution < current_date - 120 returning 1) select count(*)::int from s;
$$;
revoke all on function public.nettoyer_offres() from public, anon, authenticated;

-- =====================================================================
--  ENSUITE : donne-toi les droits d'administrateur
--  Remplace l'email ci-dessous par celui de TON compte sur le site, puis Run :
--
--  update public.profils set est_admin = true where email = 'ton.email@exemple.fr';
-- =====================================================================
