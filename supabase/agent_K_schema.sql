-- Agent K : colonnes additionnelles requises
alter table public.entreprises
  add column if not exists date_envoi timestamptz,
  add column if not exists offre_id text,
  add column if not exists offres_verifiees_le timestamptz,
  add column if not exists brevo_message_id text,
  add column if not exists objet_email text;

-- Horodatage des offres, défini lors de leur insertion par les collecteurs.
alter table public.offres
  add column if not exists lumen_collecte_le timestamptz not null default now();
