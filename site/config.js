/* ===== CONFIGURATION DU SITE : le seul fichier à modifier ===== */
window.CONFIG = {
  // Supabase (Project Settings > API). La clé "anon public" est faite pour être
  // dans le site : la sécurité est assurée par les règles de la base.
  // Ne mets JAMAIS ici la clé "service_role" : elle va uniquement dans n8n.
  SUPABASE_URL: "https://jsmffmtzoauvqltshiyg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_kDVV8tAZEirvMiVXpr4YPw_hmAdT7Mu",   // clé publique (publishable)

  // Adresses "Production" des webhooks n8n
  WEBHOOK_ANALYSE: "",     // agent « Réception analyse »
  WEBHOOK_DEMANDE: "",     // agent « Réception demande » (agents sur mesure, accompagnement)

  // Lien de paiement Stripe de l'abonnement (49 € HT / mois)
  STRIPE_ABONNEMENT: "https://buy.stripe.com/28E9AU6KN6jxbHl5tncbC01",   // 49 € HT / mois

  // Prix affiché
  PRIX: 49,

  // Départements affichés par défaut dans le panneau « En direct » de l'accueil
  DEPARTEMENTS_ACCUEIL: ["04", "05", "06", "13", "83", "84"],

  // Contact
  EMAIL: "lumeniaindustrie@gmail.com",
  TEL: "06 50 93 85 52",

  // Mode démonstration : laisser à false sur le vrai site
  DEMO: false
};
