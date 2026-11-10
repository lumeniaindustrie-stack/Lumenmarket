-- =====================================================================
--  MISE À JOUR : demandes « agents sur mesure » / « diagnostic » depuis le site
--  À coller dans Supabase > SQL Editor > New query > Run
--  Sans danger si on le relance.
--
--  Le formulaire du site dépose la demande directement dans la table demandes
--  (même si le PC est éteint, rien n'est perdu). L'agent R (n8n) vient ensuite
--  la lire, te prévient par email et envoie un accusé de réception au client.
--  Le visiteur peut seulement AJOUTER une demande : il ne peut ni lire, ni
--  modifier, ni supprimer quoi que ce soit.
-- =====================================================================

alter table public.demandes add column if not exists notifie_le timestamptz;   -- rempli par l'agent R une fois les emails partis

-- Formes et tailles autorisées
alter table public.demandes drop constraint if exists demandes_formes;
alter table public.demandes add constraint demandes_formes check (
  offre in ('agents', 'diagnostic', 'accompagnement')
  and length(email) <= 200 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  and length(besoin) between 30 and 4000
  and coalesce(length(entreprise), 0) <= 200 and coalesce(length(nom), 0) <= 120
  and coalesce(length(telephone), 0) <= 30 and coalesce(length(taille), 0) <= 60
  and coalesce(length(rappel), 0) <= 60 and coalesce(length(outils), 0) <= 500
) not valid;   -- « not valid » : les anciennes lignes ne sont pas revérifiées

-- Le site (visiteur anonyme ou client connecté) peut déposer, uniquement ces colonnes
grant insert (offre, entreprise, nom, email, telephone, taille, rappel, outils, besoin) on public.demandes to anon, authenticated;
drop policy if exists "demandes : dépôt depuis le site" on public.demandes;
create policy "demandes : dépôt depuis le site" on public.demandes for insert to anon, authenticated with check (true);

-- Garde-fous contre le spam, et valeurs imposées
create or replace function public.demande_nouvelle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) not in ('anon', 'authenticated') then return new; end if;   -- insertion par un agent : rien à vérifier
  new.email := lower(trim(new.email));
  if (select count(*) from public.demandes d where d.email = new.email and d.cree_le > now() - interval '1 day') >= 3 then
    raise exception 'Vous avez déjà envoyé plusieurs demandes aujourd''hui : nous revenons vers vous très vite.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.demandes d where d.cree_le > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes en ce moment. Réessayez dans un instant, ou écrivez-nous par email.' using errcode = 'P0001';
  end if;
  new.statut := 'à rappeler'; new.cree_le := now(); new.notifie_le := null;
  return new;
end $$;
drop trigger if exists demande_nouvelle on public.demandes;
create trigger demande_nouvelle before insert on public.demandes for each row execute function public.demande_nouvelle();
