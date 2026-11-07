-- Correctif phase 2 : nouvel essai automatique quand une analyse échoue
-- À coller dans Supabase > SQL Editor > New query > Run
alter table public.analyses add column if not exists tentatives integer not null default 0;
