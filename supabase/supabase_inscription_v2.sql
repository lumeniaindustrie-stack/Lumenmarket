-- =====================================================================
--  MISE À JOUR : nouveau parcours d'inscription (novembre 2026)
--  À coller dans Supabase > SQL Editor > New query > Run
--  Sans danger si on le relance.
--
--  Ce que ça change :
--  - nouvelle colonne email_veille : adresse qui reçoit la veille, si elle
--    est différente de l'email de connexion (l'authentification ne change pas) ;
--  - nouvelle colonne retours_inscription : avis « pertinente / à exclure »
--    donnés sur les offres exemples à la fin de l'inscription ;
--  - la création automatique du profil recopie aussi SIRET, code NAF, ville,
--    activités secondaires (description), email_veille et ces avis.
-- =====================================================================

-- Colonnes (celles du questionnaire de première connexion sont reprises ici
-- au cas où supabase_maj_profil.sql n'aurait pas été exécuté : sinon la
-- fonction ci-dessous échouerait et bloquerait toutes les inscriptions).
alter table public.profils
  add column if not exists siret               text,
  add column if not exists code_naf            text,
  add column if not exists ville               text,
  add column if not exists description         text,
  add column if not exists email_veille        text,
  add column if not exists retours_inscription jsonb;

alter table public.profils drop constraint if exists profils_email_veille;
alter table public.profils add constraint profils_email_veille check (
  email_veille is null or (length(email_veille) <= 200 and email_veille ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
);

-- Le client peut changer son adresse de réception depuis son espace
grant update (email_veille) on public.profils to authenticated;

-- Création automatique du profil à l'inscription (remplace la version de supabase.sql)
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  ev text := lower(trim(coalesce(m->>'email_veille', '')));
begin
  insert into public.profils (id, email, entreprise, siren, siret, telephone, metiers, mots_cles, departements, types, montant_min,
                              code_naf, ville, description, email_veille, retours_inscription)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(m->>'entreprise'), ''), 'Entreprise sans nom'), 200),
    case when m->>'siren' ~ '^[0-9]{9}$' then m->>'siren' end,
    case when m->>'siret' ~ '^[0-9]{14}$' then m->>'siret' end,
    left(m->>'telephone', 30),
    left(m->>'metiers', 500),
    left(m->>'mots_cles', 1500),
    left(m->>'departements', 200),           -- vide = toute la France
    coalesce(nullif(left(m->>'types', 60), ''), 'TRAVAUX, SERVICES, FOURNITURES'),
    case when m->>'montant_min' ~ '^[0-9]{1,9}$' then (m->>'montant_min')::integer end,
    nullif(left(m->>'code_naf', 10), ''),
    nullif(left(m->>'ville', 100), ''),
    nullif(left(m->>'description', 2000), ''),
    case when ev <> '' and length(ev) <= 200 and ev ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and ev <> lower(new.email) then ev end,
    case when jsonb_typeof(m->'retours_inscription') = 'array'
         then case when jsonb_array_length(m->'retours_inscription') between 1 and 10 then m->'retours_inscription' end
    end
  );
  return new;
end;
$$;

drop trigger if exists apres_inscription on auth.users;
create trigger apres_inscription
  after insert on auth.users
  for each row execute function public.creer_profil();
