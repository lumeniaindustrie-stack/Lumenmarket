-- =====================================================================
--  MISE À JOUR : suivi de l'abonnement Stripe
--  À coller dans Supabase > SQL Editor > New query > Run
--  (sans danger si on le relance)
-- =====================================================================
alter table public.profils
  add column if not exists stripe_customer_id text;

create index if not exists profils_stripe_customer_id_idx
  on public.profils (stripe_customer_id);

create index if not exists profils_email_idx
  on public.profils (lower(email));
