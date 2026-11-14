-- =====================================================================
--  Essai gratuit : 14 jours au lieu de 7 (décision du 14/11/2026)
--  1. Les nouvelles inscriptions ont 14 jours d'essai.
--  2. Les comptes encore en essai passent aussi à 14 jours à partir de leur inscription
--     (on ne raccourcit jamais un essai déjà plus long).
--  À coller dans Supabase > SQL Editor > Run. Sans danger si relancé.
-- =====================================================================
alter table public.profils alter column fin_essai set default (current_date + 14);

update public.profils
   set fin_essai = greatest(fin_essai, (cree_le at time zone 'Europe/Paris')::date + 14)
 where formule = 'essai';
