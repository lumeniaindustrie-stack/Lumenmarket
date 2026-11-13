-- =====================================================================
--  Pilotage : boutons « Garder » et « Supprimer » sur les demandes
--  L'administrateur peut changer le statut d'une demande et la supprimer.
--  À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================
grant update (statut) on public.demandes to authenticated;
grant delete on public.demandes to authenticated;

drop policy if exists "demandes : admin modifie" on public.demandes;
create policy "demandes : admin modifie" on public.demandes for update to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

drop policy if exists "demandes : admin supprime" on public.demandes;
create policy "demandes : admin supprime" on public.demandes for delete to authenticated
  using ((select public.est_admin()));
