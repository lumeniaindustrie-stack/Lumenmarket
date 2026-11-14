-- =====================================================================
--  Agent M (rappels d'abonnement) : journal des rappels envoyés à chaque client
--  Un rappel de chaque type n'est envoyé qu'une fois par client (clé unique).
--  Types : J-1, J+0, J+3, J+7, J+14, J+20 (fin d'essai), merci (nouvel abonné),
--          promo50 (abonné qui résilie : code -50 % pendant 1 an).
--  À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================
create table if not exists public.rappels_abonnement (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profils(id) on delete cascade,
  type        text not null check (type in ('J-1', 'J+0', 'J+3', 'J+7', 'J+14', 'J+20', 'merci', 'promo50')),
  envoye_le   timestamptz not null default now(),
  brevo_message_id text,
  unique (client_id, type)
);
alter table public.rappels_abonnement enable row level security;
revoke all on public.rappels_abonnement from anon, authenticated;
grant select on public.rappels_abonnement to authenticated;
drop policy if exists "admin lit rappels" on public.rappels_abonnement;
create policy "admin lit rappels" on public.rappels_abonnement for select to authenticated using ((select public.est_admin()));

-- Pour qu'un client ne reçoive plus aucun rappel (il a dit STOP, ou tu gères en direct) : mettre true
alter table public.profils add column if not exists rappels_stop boolean not null default false;

-- Les comptes déjà abonnés avant l'agent ne reçoivent pas le « merci » après coup
insert into public.rappels_abonnement (client_id, type)
select id, 'merci' from public.profils where formule in ('abonne', 'accompagnement')
on conflict (client_id, type) do nothing;

-- Les abonnés ayant déjà résilié avant l'agent ne reçoivent pas le code promo après coup
insert into public.rappels_abonnement (client_id, type)
select id, 'promo50' from public.profils where formule in ('abonne', 'accompagnement') and actif = false
on conflict (client_id, type) do nothing;
