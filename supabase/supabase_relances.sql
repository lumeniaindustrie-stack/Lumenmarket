-- =====================================================================
--  Agent L (relances) : colonnes de suivi + accès du pilotage à la table entreprises
--  À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================
alter table public.entreprises
  add column if not exists relance_le timestamptz,
  add column if not exists relance_message_id text;

create index if not exists entreprises_relance_idx on public.entreprises (statut, relance_le, date_envoi);

-- Le pilotage (compte administrateur uniquement, grâce aux règles RLS déjà en place)
-- peut lire la table et changer le statut d'une entreprise (répondu, STOP…)
grant select, update on public.entreprises to authenticated;
