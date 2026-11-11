-- =====================================================================
--  PROSPECTION (agents F et K) : tout le schéma nécessaire en un seul fichier
--  À coller dans Supabase > SQL Editor > New query > Run
--  Sans danger si on le relance : ce qui existe déjà est ignoré.
--  (Regroupe entreprises.sql + agent_F_schema.sql + agent_K_schema.sql)
-- =====================================================================

create table if not exists public.entreprises (
  siret text primary key,
  siren text,
  nom text not null,
  secteur text,
  ville text,
  departement text,
  dirigeant text,
  site_web text,
  email text,
  source_marche text,       -- objet du marché public qui a révélé cette entreprise
  montant_marche numeric,
  date_attribution date,
  statut text not null default 'à qualifier',   -- à qualifier / contacté / relance_1 / relance_2 / répondu / refusé / client
  trouve_le timestamptz not null default now(),
  contacte_le timestamptz,
  relance_1_le timestamptz,
  relance_2_le timestamptz,
  notes text
);

create index if not exists entreprises_statut_idx on public.entreprises (statut);
create index if not exists entreprises_departement_idx on public.entreprises (departement);

alter table public.entreprises enable row level security;
revoke all on public.entreprises from anon, authenticated;

-- Données commerciales internes (coordonnées de dirigeants, etc.) : réservées à
-- l'administrateur connecté (public.est_admin(), défini dans supabase_phase1.sql).
-- IMPORTANT : "to authenticated" seul autoriserait N'IMPORTE QUEL client inscrit
-- (pas seulement l'administrateur) à lire/modifier toute la base de prospection —
-- d'où le filtre explicite sur est_admin() ci-dessous.
-- L'agent F écrit via la clé service_role de n8n, qui n'est pas soumise à ces règles RLS.
drop policy if exists "admin lit entreprises" on public.entreprises;
drop policy if exists "admin modifie entreprises" on public.entreprises;
create policy "admin lit entreprises" on public.entreprises for select to authenticated using ((select public.est_admin()));
create policy "admin modifie entreprises" on public.entreprises for all to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));

-- ---------- Colonnes de l'agent F (v2) ----------
alter table public.entreprises
  add column if not exists domaine_activite text,
  add column if not exists effectif_tranche text,
  add column if not exists source_type text,
  add column if not exists source_url text,
  add column if not exists email_type text,
  add column if not exists email_statut text,
  add column if not exists email_valide boolean;


-- ---------- Colonnes de l'agent K ----------
alter table public.entreprises
  add column if not exists date_envoi timestamptz,
  add column if not exists offre_id text,
  add column if not exists offres_verifiees_le timestamptz,
  add column if not exists brevo_message_id text,
  add column if not exists objet_email text;

-- Horodatage des offres, défini lors de leur insertion par les collecteurs.
alter table public.offres
  add column if not exists lumen_collecte_le timestamptz not null default now();

-- Vérification : doit afficher 0 ligne « MANQUANTE »
select c as colonne, 'MANQUANTE' as etat
from unnest(array['siret','siren','nom','departement','secteur','domaine_activite','effectif_tranche','dirigeant','email',
  'email_type','email_statut','email_valide','site_web','source_type','source_url','source_marche','date_attribution',
  'montant_marche','statut','trouve_le','date_envoi','offre_id','offres_verifiees_le','brevo_message_id','objet_email']) c
where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entreprises' and column_name = c);
