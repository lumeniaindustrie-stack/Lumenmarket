-- =====================================================================
--  Page personnalisée pour chaque prospect : lumen-marche.fr/pour.html?p=<jeton>
--  - chaque entreprise prospectée reçoit un jeton secret (dans le lien de son email)
--  - l'Agent K note les offres qu'il a rapprochées de l'entreprise (offres_suggerees)
--  - la page appelle page_prospect(jeton) : nom, prénom du dirigeant, ville, offres encore ouvertes
--  - chaque visite est comptée (page_vues, page_vue_le) : tu vois qui a regardé sa page
--  À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================
alter table public.entreprises
  add column if not exists jeton uuid not null default gen_random_uuid(),
  add column if not exists offres_suggerees text[],
  add column if not exists page_vues integer not null default 0,
  add column if not exists page_vue_le timestamptz,
  add column if not exists page_derniere_vue timestamptz;
create unique index if not exists entreprises_jeton_idx on public.entreprises (jeton);

create or replace function public.page_prospect(p_jeton uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.entreprises%rowtype;
  ids text[];
  res json;
begin
  select * into e from public.entreprises where jeton = p_jeton;
  if not found then return null; end if;

  update public.entreprises
     set page_vues = page_vues + 1,
         page_vue_le = coalesce(page_vue_le, now()),
         page_derniere_vue = now()
   where siret = e.siret;

  ids := coalesce(e.offres_suggerees, '{}'::text[]);
  if e.offre_id is not null and not (e.offre_id = any(ids)) then ids := array_prepend(e.offre_id, ids); end if;

  select json_build_object(
    'entreprise', json_build_object(
      'nom', e.nom, 'dirigeant', e.dirigeant, 'ville', e.ville, 'departement', e.departement,
      'siren', e.siren, 'email', e.email, 'activite', coalesce(e.domaine_activite, e.secteur),
      'marche_gagne', e.source_marche),
    'offre_principale', e.offre_id,
    'offres', coalesce((
      select json_agg(json_build_object(
               'avis_id', o.avis_id, 'objet', o.objet, 'acheteur', o.acheteur, 'lieu', o.lieu,
               'departements', o.departements, 'type_marche', o.type_marche, 'montant', o.montant,
               'limite', o.limite, 'url', o.url)
             order by (o.avis_id = e.offre_id) desc, o.limite asc)
        from public.offres o
       where o.avis_id = any(ids) and o.limite > now()), '[]'::json),
    'nb_ouvertes_departement', (
      select count(*) from public.offres o
       where o.limite > now() and e.departement is not null and e.departement = any(o.departements))
  ) into res;
  return res;
end $$;

revoke all on function public.page_prospect(uuid) from public;
grant execute on function public.page_prospect(uuid) to anon, authenticated;
