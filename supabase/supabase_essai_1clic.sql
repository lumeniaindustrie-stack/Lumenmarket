-- =====================================================================
-- Lumen : essai en 1 clic depuis la page personnalisée d'un prospect
--  - le prospect clique « Essayer gratuitement 14 jours » sur pour.html
--  - son compte est créé à partir de son lien personnel (jeton reçu par email :
--    c'est la preuve qu'il a accès à cette adresse), sans formulaire
--  - il arrive directement dans son tableau de bord
--  - à sa 2e connexion, on lui demande son téléphone et son mot de passe
-- À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================

alter table public.profils
  add column if not exists essai_1clic boolean not null default false,
  add column if not exists compte_a_finaliser boolean not null default false,
  add column if not exists visites integer not null default 0;

-- Crée (ou rouvre, tant que le compte n'est pas finalisé) le compte d'essai d'un prospect.
-- Le mot de passe est aléatoire, généré par la page et jamais montré : il sert seulement
-- à ouvrir la session tout de suite. Le client choisit le sien à la 2e connexion.
create or replace function public.activer_essai_prospect(p_jeton uuid, p_mdp text, p_metiers text default null, p_mots text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  e public.entreprises%rowtype;
  uid uuid;
  v_email text;
  fin boolean;
begin
  if length(coalesce(p_mdp, '')) < 24 then return json_build_object('etat', 'erreur'); end if;
  select * into e from public.entreprises where jeton = p_jeton;
  if not found or coalesce(trim(e.email), '') = '' then return json_build_object('etat', 'lien_invalide'); end if;
  if e.date_envoi is null or e.date_envoi < now() - interval '90 days' then return json_build_object('etat', 'lien_expire'); end if;
  v_email := lower(trim(e.email));

  select id into uid from auth.users where lower(email) = v_email limit 1;
  if uid is not null then
    select compte_a_finaliser into fin from public.profils where id = uid;
    if coalesce(fin, false) then
      -- compte d'essai pas encore finalisé : on le rouvre (autre appareil, cookies effacés…)
      update auth.users set encrypted_password = crypt(p_mdp, gen_salt('bf')), updated_at = now() where id = uid;
      return json_build_object('etat', 'ok', 'email', v_email, 'nouveau', false);
    end if;
    return json_build_object('etat', 'existe', 'email', v_email);
  end if;

  uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
          crypt(p_mdp, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object(
            'entreprise', e.nom, 'siren', e.siren, 'siret', e.siret,
            'metiers', left(coalesce(nullif(trim(p_metiers), ''), e.domaine_activite, e.secteur, ''), 500),
            'mots_cles', left(coalesce(p_mots, ''), 1500),
            'departements', coalesce(e.departement, ''),
            'ville', coalesce(e.ville, '')),
          now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());

  -- la fiche « profils » est créée par le déclencheur apres_inscription ; on la marque
  update public.profils set essai_1clic = true, compte_a_finaliser = true where id = uid;
  return json_build_object('etat', 'ok', 'email', v_email, 'nouveau', true);
end;
$$;
revoke all on function public.activer_essai_prospect(uuid, text, text, text) from public;
grant execute on function public.activer_essai_prospect(uuid, text, text, text) to anon, authenticated;

-- Compte une visite de l'espace client (une par session de navigateur)
create or replace function public.compter_visite()
returns json
language sql
security definer
set search_path = public
as $$
  update public.profils set visites = visites + 1 where id = auth.uid()
  returning json_build_object('visites', visites, 'compte_a_finaliser', compte_a_finaliser);
$$;
revoke all on function public.compter_visite() from public;
grant execute on function public.compter_visite() to authenticated;

-- Fin de la finalisation : téléphone enregistré, plus de fenêtre
create or replace function public.finaliser_compte(p_telephone text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profils
     set telephone = coalesce(nullif(left(trim(p_telephone), 30), ''), telephone),
         compte_a_finaliser = false
   where id = auth.uid();
$$;
revoke all on function public.finaliser_compte(text) from public;
grant execute on function public.finaliser_compte(text) to authenticated;
