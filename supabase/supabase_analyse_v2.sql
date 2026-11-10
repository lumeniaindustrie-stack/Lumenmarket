-- =====================================================================
--  MISE À JOUR : analyse automatique d'une offre (bouton « Analyser »)
--  À coller dans Supabase > SQL Editor > New query > Run
--  Sans danger si on le relance.
--
--  - mode 'pdf'  : le client dépose les PDF (fonctionnement actuel) ;
--  - mode 'auto' : le client clique « Analyser » sur une offre ; l'agent D va
--    lui-même chercher l'avis officiel et le dossier de consultation (DCE).
--  Un dépôt de PDF peut aussi être rattaché à une offre (avis_id / avis_url) :
--  l'agent lit alors l'avis officiel en plus des PDF.
-- =====================================================================

alter table public.analyses
  add column if not exists mode       text not null default 'pdf',
  add column if not exists avis_id    text,
  add column if not exists avis_url   text,
  add column if not exists avis_objet text;

-- Contrôles : ces valeurs viennent du navigateur du client. L'agent les reçoit encodées
-- (jamais telles quelles dans une ligne de commande), mais on borne quand même leur forme.
alter table public.analyses drop constraint if exists analyses_mode;
alter table public.analyses add constraint analyses_mode check (mode in ('pdf', 'auto'));
alter table public.analyses drop constraint if exists analyses_avis;
alter table public.analyses add constraint analyses_avis check (
  (avis_url is null or (length(avis_url) <= 1000 and avis_url ~ '^https?://[^\s"''<>`]+$'))
  and (avis_id is null or (length(avis_id) <= 120 and avis_id ~ '^[A-Za-z0-9._:-]+$'))
  and (avis_objet is null or length(avis_objet) <= 500)
);

-- Le client peut déposer ces champs (en plus du texte des PDF)
grant insert (texte, mode, avis_id, avis_url, avis_objet) on public.analyses to authenticated;

create or replace function public.analyse_nouvelle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;              -- insertion par un agent : rien à vérifier
  if not public.compte_utilisable() then
    raise exception 'Votre compte n''est pas actif ou votre essai est terminé.' using errcode = 'P0001';
  end if;
  if coalesce(new.mode, 'pdf') = 'auto' then
    if new.avis_url is null then
      raise exception 'Cette offre n''a pas d''adresse : ouvrez l''avis et déposez les PDF du dossier.' using errcode = 'P0001';
    end if;
    new.texte := null;                                                  -- l'agent va chercher les documents lui-même
  elsif length(coalesce(new.texte, '')) < 200 then
    raise exception 'Le dossier ne contient pas assez de texte lisible.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.analyses a where a.client_id = (select auth.uid()) and a.cree_le > now() - interval '1 day') >= 10 then
    raise exception 'Limite atteinte : 10 analyses par jour. Réessayez demain.' using errcode = 'P0001';
  end if;
  new.client_id := (select auth.uid());
  new.mode := coalesce(new.mode, 'pdf');
  new.statut := 'en_attente'; new.tentatives := 0; new.resultat := null; new.objet := null; new.decision := null;
  new.message := null; new.termine_le := null; new.cree_le := now();
  return new;
end $$;

drop trigger if exists analyse_nouvelle on public.analyses;
create trigger analyse_nouvelle before insert on public.analyses for each row execute function public.analyse_nouvelle();
