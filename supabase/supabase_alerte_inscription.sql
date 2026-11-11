-- =====================================================================
--  MISE À JOUR : alerte email à chaque nouveau compte client (Agent I)
--  À coller dans Supabase > SQL Editor > New query > Run
--
--  Ajoute la colonne alerte_admin_le sur profils : l'agent I la remplit une
--  fois l'email d'alerte envoyé. Les comptes déjà existants sont marqués
--  comme « déjà signalés » pour ne pas recevoir une alerte pour chacun.
-- =====================================================================

alter table public.profils add column if not exists alerte_admin_le timestamptz;

-- Comptes créés avant ce script : pas d'alerte rétroactive
update public.profils set alerte_admin_le = now()
where alerte_admin_le is null and cree_le < now() - interval '10 minutes';

-- Un client ne peut pas modifier lui-même ce champ (il n'est mis à jour que par l'agent, clé service_role)
do $$ begin
  if exists (select 1 from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'profils' and column_name = 'alerte_admin_le'
               and grantee = 'authenticated' and privilege_type = 'UPDATE') then
    revoke update (alerte_admin_le) on public.profils from authenticated;
  end if;
end $$;
