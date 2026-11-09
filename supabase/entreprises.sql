-- Table "entreprises" : base de prospection commerciale (agent F), indépendante
-- de la table "offres" (marchés publics, agents E1-E9). Alimentée automatiquement
-- par l'agent F (découverte via les avis d'attribution du BOAMP), et à compléter
--/qualifier manuellement (email, site web, notes) au fil de la prospection.
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

-- Données commerciales internes (coordonnées de dirigeants, etc.) : réservées à
-- l'administrateur connecté. L'agent F écrit via la clé service_role de n8n, qui
-- n'est pas soumise à ces règles RLS.
create policy "admin lit entreprises" on public.entreprises for select to authenticated using (true);
create policy "admin modifie entreprises" on public.entreprises for all to authenticated using (true) with check (true);
