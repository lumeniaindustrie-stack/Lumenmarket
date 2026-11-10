-- =====================================================================
--  MISE À JOUR : heure d'envoi des offres (limite de 2 emails par jour)
--  À coller dans Supabase > SQL Editor > New query > Run
--  Sans danger si on le relance.
--
--  Toutes les offres d'un même email sont enregistrées en une seule fois,
--  donc avec la même heure : l'Agent B compte ainsi les emails déjà
--  envoyés aujourd'hui à chaque client.
-- =====================================================================
alter table public.offres_envoyees
  add column if not exists envoye_le timestamptz not null default now();
