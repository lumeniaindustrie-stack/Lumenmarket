-- Passe l'essai gratuit de 1 mois à 1 semaine.
-- Change uniquement la valeur par défaut : les clients déjà inscrits gardent
-- leur fin d'essai actuelle (30 jours). Seules les NOUVELLES inscriptions
-- auront 7 jours à partir de maintenant.
alter table public.profils alter column fin_essai set default (current_date + 7);
