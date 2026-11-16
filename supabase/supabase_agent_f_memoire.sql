-- =====================================================================
--  Agent F : mémoire des entreprises écartées + lecture rapide des SIREN connus
--  - entreprises_ecartees : chaque SIREN écarté (site introuvable, trop grande, organisme public…)
--    n'est pas réessayé avant la date bloque_jusqu_au (30 jours à 1 an selon la raison)
--  - sirens_connus() : renvoie en une seule ligne tous les SIREN déjà en base et ceux encore bloqués
--    (contourne la limite de 1 000 lignes par requête de Supabase)
--  À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================
create table if not exists public.entreprises_ecartees (
  siren          text primary key,
  raison         text not null,
  le             timestamptz not null default now(),
  bloque_jusqu_au timestamptz not null,
  essais         integer not null default 1
);
create index if not exists entreprises_ecartees_bloque_idx on public.entreprises_ecartees (bloque_jusqu_au);
alter table public.entreprises_ecartees enable row level security;
revoke all on public.entreprises_ecartees from anon, authenticated;
grant select on public.entreprises_ecartees to authenticated;
drop policy if exists "admin lit ecartees" on public.entreprises_ecartees;
create policy "admin lit ecartees" on public.entreprises_ecartees for select to authenticated using ((select public.est_admin()));

-- Un SIREN de nouveau écarté : on compte l'essai et on prolonge le blocage
create or replace function public.ecartees_essai() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.essais := old.essais + 1; end if;
  return new;
end $$;
drop trigger if exists ecartees_essai on public.entreprises_ecartees;
create trigger ecartees_essai before update on public.entreprises_ecartees for each row execute function public.ecartees_essai();

create or replace function public.sirens_connus()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'base', coalesce((select json_agg(distinct siren) from public.entreprises where siren is not null), '[]'::json),
    'ecartees', coalesce((select json_agg(siren) from public.entreprises_ecartees where bloque_jusqu_au > now()), '[]'::json));
$$;
revoke all on function public.sirens_connus() from public, anon, authenticated;
