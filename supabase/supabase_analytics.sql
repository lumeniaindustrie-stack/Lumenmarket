-- =====================================================================
--  MISE À JOUR : page « Analytique » du pilotage
--  À coller dans Supabase > SQL Editor > New query > Run (sans danger si relancé)
--
--  1. Journal des abonnements : chaque passage d'un client en payant, chaque
--     résiliation est enregistré automatiquement (qu'il vienne de Stripe via
--     l'agent H ou d'une modification à la main dans le Table Editor).
--     C'est ce qui permet de tracer le revenu et la rétention dans le temps.
--  2. Fonction stats_pilotage(jours) : renvoie, jour par jour, les chiffres
--     de la page Analytique (offres stockées, envoyées, inscriptions,
--     prospection, paiements…). Réservée à l'administrateur.
-- =====================================================================

-- Colonnes utilisées par les graphiques (déjà créées par agent_K_schema.sql
-- si tu l'as exécuté ; sinon elles sont ajoutées ici, vides)
alter table public.entreprises add column if not exists date_envoi timestamptz;
alter table public.entreprises add column if not exists email_valide boolean;
alter table public.offres_envoyees add column if not exists envoye_le timestamptz;

-- ---------- 1. Journal des abonnements ----------
create table if not exists public.abonnements_journal (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.profils(id) on delete cascade,
  evenement  text not null check (evenement in ('abonnement', 'resiliation')),
  formule    text,
  le         timestamptz not null default now(),
  estime     boolean not null default false   -- true : date reconstituée pour un client déjà abonné avant ce script
);
create index if not exists abonnements_journal_le on public.abonnements_journal (le);
create index if not exists abonnements_journal_client on public.abonnements_journal (client_id, le);

alter table public.abonnements_journal enable row level security;
revoke all on public.abonnements_journal from anon, authenticated;
grant select on public.abonnements_journal to authenticated;
drop policy if exists "abonnements : admin" on public.abonnements_journal;
create policy "abonnements : admin" on public.abonnements_journal for select to authenticated using ((select public.est_admin()));

-- Un client « paie » s'il est actif avec une formule autre que l'essai
create or replace function public.journaliser_abonnement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  avant boolean := tg_op = 'UPDATE' and old.actif is not false and coalesce(old.formule, 'essai') <> 'essai';
  apres boolean := new.actif is not false and coalesce(new.formule, 'essai') <> 'essai';
begin
  if new.est_admin then return new; end if;
  if apres and not avant then
    insert into public.abonnements_journal (client_id, evenement, formule) values (new.id, 'abonnement', new.formule);
  elsif avant and not apres then
    insert into public.abonnements_journal (client_id, evenement, formule) values (new.id, 'resiliation', old.formule);
  end if;
  return new;
end $$;
drop trigger if exists journaliser_abonnement on public.profils;
create trigger journaliser_abonnement after insert or update of formule, actif on public.profils
  for each row execute function public.journaliser_abonnement();

-- Clients déjà abonnés avant ce script : date reconstituée (fin d'essai, sinon inscription)
insert into public.abonnements_journal (client_id, evenement, formule, le, estime)
select p.id, 'abonnement', p.formule,
       least(now(), coalesce(p.fin_essai::timestamptz, p.cree_le)), true
from public.profils p
where p.est_admin is not true and p.actif is not false and coalesce(p.formule, 'essai') <> 'essai'
  and not exists (select 1 from public.abonnements_journal j where j.client_id = p.id);

-- ---------- 2. Séries jour par jour pour la page Analytique ----------
create or replace function public.stats_pilotage(jours integer default 90)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  n   integer := greatest(7, least(coalesce(jours, 90), 730));
  d0  date := (now() at time zone 'Europe/Paris')::date - (n - 1);
  res jsonb;
begin
  if not (select public.est_admin()) then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  with j as (select generate_series(d0, d0 + (n - 1), interval '1 day')::date as d),
  oc as (select (collecte_le at time zone 'Europe/Paris')::date d, count(*) c from public.offres
         where collecte_le >= d0::timestamp at time zone 'Europe/Paris' group by 1),
  -- offres ouvertes chaque jour : +1 le jour de la collecte, −1 le lendemain de la date limite
  o2 as (select (collecte_le at time zone 'Europe/Paris')::date dc, (limite at time zone 'Europe/Paris')::date dl from public.offres),
  ev as (select greatest(dc, d0) d, 1 c from o2 where dl is null or (dl >= d0 and dl >= dc)
         union all
         select dl + 1, -1 from o2 where dl >= d0 and dl >= dc and dl + 1 <= d0 + (n - 1)),
  evj as (select d, sum(c) c from ev group by d),
  ouv as (select j.d, sum(coalesce(evj.c, 0)) over (order by j.d) c from j left join evj using (d)),
  oe as (select date_envoi d, count(*) c, count(distinct client_id) cl from public.offres_envoyees where date_envoi >= d0 group by 1),
  ins as (select (cree_le at time zone 'Europe/Paris')::date d, count(*) c from public.profils
          where est_admin is not true and cree_le >= d0::timestamp at time zone 'Europe/Paris' group by 1),
  an as (select (cree_le at time zone 'Europe/Paris')::date d, count(*) c from public.analyses
         where cree_le >= d0::timestamp at time zone 'Europe/Paris' group by 1),
  pe as (select (date_envoi at time zone 'Europe/Paris')::date d, count(*) c from public.entreprises
         where date_envoi >= d0::timestamp at time zone 'Europe/Paris' group by 1),
  pt as (select (trouve_le at time zone 'Europe/Paris')::date d, count(*) c from public.entreprises
         where trouve_le >= d0::timestamp at time zone 'Europe/Paris' group by 1),
  de as (select (cree_le at time zone 'Europe/Paris')::date d, count(*) c from public.demandes
         where cree_le >= d0::timestamp at time zone 'Europe/Paris' group by 1),
  pa as (select (debut at time zone 'Europe/Paris')::date d, count(*) c from public.agent_runs
         where agent = 'H-comptable' and statut <> 'erreur' and details->>'type' = 'invoice.paid'
           and debut >= d0::timestamp at time zone 'Europe/Paris' group by 1)
  select jsonb_build_object(
    'debut', d0,
    'jours', jsonb_agg(j.d order by j.d),
    'offres_collectees', jsonb_agg(coalesce(oc.c, 0) order by j.d),
    'offres_ouvertes', jsonb_agg(coalesce(ouv.c, 0) order by j.d),
    'offres_envoyees', jsonb_agg(coalesce(oe.c, 0) order by j.d),
    'clients_servis', jsonb_agg(coalesce(oe.cl, 0) order by j.d),
    'inscriptions', jsonb_agg(coalesce(ins.c, 0) order by j.d),
    'analyses', jsonb_agg(coalesce(an.c, 0) order by j.d),
    'prospection_envoyes', jsonb_agg(coalesce(pe.c, 0) order by j.d),
    'prospection_trouvees', jsonb_agg(coalesce(pt.c, 0) order by j.d),
    'demandes', jsonb_agg(coalesce(de.c, 0) order by j.d),
    'paiements', jsonb_agg(coalesce(pa.c, 0) order by j.d),
    -- totaux avant la période, pour tracer les courbes cumulées
    'offres_avant', (select count(*) from public.offres where collecte_le < d0::timestamp at time zone 'Europe/Paris'),
    'offres_total', (select count(*) from public.offres),
    'prospection_total_envoyes', (select count(*) from public.entreprises where date_envoi is not null),
    'prospection_total_trouvees', (select count(*) from public.entreprises),
    'prospection_a_contacter', (select count(*) from public.entreprises where date_envoi is null and email_valide is true),
    -- entreprises prospectées qui se sont inscrites ensuite (même SIREN), puis devenues payantes
    'prospection_inscrits', (select count(distinct p.id) from public.profils p join public.entreprises e
        on e.siren = left(regexp_replace(coalesce(p.siren, ''), '\D', '', 'g'), 9)
       where p.est_admin is not true and e.date_envoi is not null and p.cree_le >= e.date_envoi),
    'prospection_payants', (select count(distinct p.id) from public.profils p join public.entreprises e
        on e.siren = left(regexp_replace(coalesce(p.siren, ''), '\D', '', 'g'), 9)
       where p.est_admin is not true and e.date_envoi is not null and p.cree_le >= e.date_envoi
         and p.actif is not false and coalesce(p.formule, 'essai') <> 'essai')
  ) into res
  from j left join oc using (d) left join ouv using (d) left join oe using (d) left join ins using (d)
         left join an using (d) left join pe using (d) left join pt using (d) left join de using (d) left join pa using (d);
  return res;
end $$;
revoke all on function public.stats_pilotage(integer) from public, anon;
grant execute on function public.stats_pilotage(integer) to authenticated;
