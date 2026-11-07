-- =====================================================================
--  PHASE 2 : chat avec l'agent (C) et analyse des dossiers (D)
--  Le site dépose les demandes dans la base ; les agents sur le PC
--  viennent les chercher et y écrivent leurs réponses.
--  À coller dans Supabase > SQL Editor > New query > Run (sans danger si relancé)
-- =====================================================================

-- ---------- Garde-fou commun : le compte peut-il utiliser les agents ? ----------
create or replace function public.compte_utilisable()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.actif is not false
       and (coalesce(p.formule, 'essai') <> 'essai' or p.fin_essai is null or p.fin_essai >= current_date)
    from public.profils p where p.id = (select auth.uid())), false);
$$;
revoke all on function public.compte_utilisable() from public;
grant execute on function public.compte_utilisable() to authenticated;

-- ---------- Analyses de dossiers : deviennent une file d'attente ----------
alter table public.analyses alter column client_id set default auth.uid();
alter table public.analyses add column if not exists statut    text not null default 'terminee';
alter table public.analyses add column if not exists texte     text;          -- texte des PDF, effacé après l'analyse
alter table public.analyses add column if not exists resultat  jsonb;
alter table public.analyses add column if not exists message   text;
alter table public.analyses add column if not exists termine_le timestamptz;
alter table public.analyses add column if not exists tentatives integer not null default 0;   -- nouvel essai automatique après un échec
alter table public.analyses drop constraint if exists analyses_statut;
alter table public.analyses add constraint analyses_statut check (statut in ('en_attente', 'en_cours', 'terminee', 'erreur'));
alter table public.analyses drop constraint if exists analyses_texte_taille;
alter table public.analyses add constraint analyses_texte_taille check (texte is null or length(texte) <= 200000);
create index if not exists analyses_file on public.analyses (statut, cree_le) where statut in ('en_attente', 'en_cours');

create or replace function public.analyse_nouvelle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;              -- insertion par un agent : rien à vérifier
  if not public.compte_utilisable() then
    raise exception 'Votre compte n''est pas actif ou votre essai est terminé.' using errcode = 'P0001';
  end if;
  if length(coalesce(new.texte, '')) < 200 then
    raise exception 'Le dossier ne contient pas assez de texte lisible.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.analyses a where a.client_id = new.client_id and a.cree_le > now() - interval '1 day') >= 10 then
    raise exception 'Limite atteinte : 10 analyses par jour. Réessayez demain.' using errcode = 'P0001';
  end if;
  new.client_id := (select auth.uid());
  new.statut := 'en_attente'; new.tentatives := 0; new.resultat := null; new.objet := null; new.decision := null; new.message := null; new.termine_le := null; new.cree_le := now();
  return new;
end $$;
drop trigger if exists analyse_nouvelle on public.analyses;
create trigger analyse_nouvelle before insert on public.analyses for each row execute function public.analyse_nouvelle();

grant insert (texte) on public.analyses to authenticated;
drop policy if exists "analyses : dépôt" on public.analyses;
create policy "analyses : dépôt" on public.analyses for insert to authenticated with check ((select auth.uid()) = client_id);

-- ---------- Chat avec l'agent ----------
create table if not exists public.messages_chat (
  id         bigint generated always as identity primary key,
  client_id  uuid not null default auth.uid() references public.profils(id) on delete cascade,
  cree_le    timestamptz not null default now(),
  role       text not null default 'client' check (role in ('client', 'agent')),
  contenu    text not null check (length(contenu) between 1 and 4000),
  avis_id    text,                                                  -- offre dont parle le message (facultatif)
  statut     text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'repondu', 'erreur'))
);
create index if not exists messages_client on public.messages_chat (client_id, cree_le desc);
create index if not exists messages_file on public.messages_chat (statut, cree_le) where statut in ('en_attente', 'en_cours');

create or replace function public.message_nouveau()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if not public.compte_utilisable() then
    raise exception 'Votre compte n''est pas actif ou votre essai est terminé.' using errcode = 'P0001';
  end if;
  if length(new.contenu) > 1500 then
    raise exception 'Message trop long (1 500 caractères au maximum).' using errcode = 'P0001';
  end if;
  if (select count(*) from public.messages_chat m where m.client_id = (select auth.uid()) and m.role = 'client' and m.cree_le > now() - interval '1 day') >= 60 then
    raise exception 'Limite atteinte : 60 questions par jour. Réessayez demain.' using errcode = 'P0001';
  end if;
  new.client_id := (select auth.uid()); new.role := 'client'; new.statut := 'en_attente'; new.cree_le := now();
  return new;
end $$;
drop trigger if exists message_nouveau on public.messages_chat;
create trigger message_nouveau before insert on public.messages_chat for each row execute function public.message_nouveau();

alter table public.messages_chat enable row level security;
revoke all on public.messages_chat from anon, authenticated;
grant select on public.messages_chat to authenticated;
grant insert (contenu, avis_id) on public.messages_chat to authenticated;
drop policy if exists "chat : lecture" on public.messages_chat;
create policy "chat : lecture" on public.messages_chat for select to authenticated
  using ((select auth.uid()) = client_id or (select public.est_admin()));
drop policy if exists "chat : envoi" on public.messages_chat;
create policy "chat : envoi" on public.messages_chat for insert to authenticated
  with check ((select auth.uid()) = client_id and role = 'client');
