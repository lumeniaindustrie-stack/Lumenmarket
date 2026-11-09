/* Lumen Pilotage : description des agents, partagée par le tableau de bord et la page d'analytics */
const AGENTS = [
  { code: "A-collecteur", nom: "Agent A", titre: "Collecteur", pole: "Pôle technique", role: "Récupère toutes les offres publiques du BOAMP, toutes les 2 heures de 6 h à 20 h.", rythme: 3, entree: "avis lus", sortie: "offres stockées", heures: [6, 21] },
  { code: "B-tri", nom: "Agent B", titre: "Tri par client", pole: "Pôle technique", role: "Note les nouvelles offres pour chaque client et envoie la veille du matin.", rythme: 26, entree: "clients traités", sortie: "offres envoyées", jours: [1, 2, 3, 4, 5] },
  { code: "C-chat", nom: "Agent C", titre: "Chat client", pole: "Pôle technique", role: "Répond aux questions des clients dans le menu Assistant de leur espace, à partir de leurs offres et des offres ouvertes de leur zone.", rythme: 2, entree: "questions", sortie: "réponses", heures: [8, 23] },
  { code: "D-analyse", nom: "Agent D", titre: "Analyse de dossiers", pole: "Pôle technique", role: "Lit les dossiers de consultation déposés par les clients et rend pièces, critères, risques et avis, sur le site et par email.", rythme: 2, entree: "dossiers reçus", sortie: "analyses rendues", heures: [8, 23] },
  { code: "E-prospection", nom: "Agent E", titre: "Coordinateur collecte", pole: "Pôle prospection", role: "Pilote 8 sous-agents dédiés chacun à une plateforme de profils acheteurs (PLACE, AWS-Achat, e-marchespublics, Maximilien, Klekoon, e-Bourgogne, Mégalis Bretagne, Achat Public), regroupe leurs offres et vérifie qu'ils ont bien fonctionné.", avenir: "Phase 3", entree: "offres des 8 sous-agents", sortie: "offres consolidées" },
  { code: "F-commercial", nom: "Agent F", titre: "Emails et relances", pole: "Pôle commercial", role: "Envoie les emails de prospection et les relances.", avenir: "Phase 3", entree: "prospects", sortie: "emails envoyés" },
  { code: "G-controle", nom: "Agent G", titre: "Contrôleur", pole: "Pôle management", role: "Vérifie toutes les heures, de 7 h à 22 h, que les agents travaillent, et t'envoie un email en cas de problème, plus un rapport chaque soir.", rythme: 2, entree: "contrôles", sortie: "alertes envoyées", heures: [8, 23] },
  { code: "H-comptable", nom: "Agent H", titre: "Comptable", pole: "Pôle comptabilité", role: "Suit les recettes, les dépenses et la marge.", avenir: "Phase 4", entree: "opérations", sortie: "rapports" }
];
const TACHES = {
  "A-collecteur": ["Interroge le BOAMP, la source officielle des marchés publics", "Garde uniquement les vrais appels d'offres (pas les attributions ni les rectificatifs)", "Calcule le montant, le lieu, la durée et le nombre de lots", "Range chaque offre dans la base, sans doublon"],
  "C-chat": ["Regarde toutes les 15 secondes si un client a posé une question", "Relit son profil, les offres qu'on lui a proposées et cherche les offres ouvertes de sa zone", "Fait répondre l'IA (Ollama) en s'appuyant uniquement sur ces offres", "Écrit la réponse dans l'espace du client"],
  "D-analyse": ["Regarde toutes les 20 secondes si un client a déposé un dossier", "Remet les pièces dans l'ordre (règlement de consultation d'abord)", "Fait analyser le dossier par l'IA : pièces, critères, risques, avis", "Enregistre l'analyse dans l'espace du client, efface le texte du dossier et l'envoie par email"],
  "G-controle": ["Vérifie que l'agent A collecte bien toutes les 2 heures", "Vérifie que l'agent B a envoyé la veille du matin", "Vérifie qu'Ollama répond", "T'envoie un email au premier problème (sans le répéter pendant 6 h) et un rapport chaque soir à 21 h"],
  "B-tri": ["Présélectionne pour chaque client les offres de sa zone, de son activité et de sa taille", "Fait noter chaque offre de 1 à 5 par l'IA (Ollama), avec un résumé", "Range les offres notées 3 ou plus dans le tableau de bord du client", "Envoie l'email de veille du matin"]
};
const ICONES = {
  "A-collecteur": '<path d="M12 2.5c.66 0 1.2.54 1.2 1.2v7.3l2.35-2.35a1.2 1.2 0 1 1 1.7 1.7l-4.4 4.4a1.2 1.2 0 0 1-1.7 0l-4.4-4.4a1.2 1.2 0 1 1 1.7-1.7l2.35 2.35V3.7c0-.66.54-1.2 1.2-1.2z"/><path d="M3 14.6c0-.55.45-1 1-1h3.1c.47 0 .86.33.97.78.42 1.62 2.02 2.82 3.93 2.82s3.51-1.2 3.93-2.82c.11-.45.5-.78.97-.78H20c.55 0 1 .45 1 1v4.4a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 19z"/>',
  "B-tri": '<path d="M3.6 3.8h16.8a1 1 0 0 1 .78 1.63L14.6 13.6v5.6a1 1 0 0 1-.55.9l-3.1 1.55a1 1 0 0 1-1.45-.9V13.6L2.82 5.43A1 1 0 0 1 3.6 3.8z"/>',
  "C-chat": '<path d="M12 3.2c5.08 0 9.2 3.42 9.2 7.65s-4.12 7.65-9.2 7.65c-.98 0-1.93-.13-2.82-.37l-3.86 2.03c-.63.33-1.35-.23-1.18-.92l.78-3.15C3.65 14.7 2.8 12.86 2.8 10.85 2.8 6.62 6.92 3.2 12 3.2z"/>',
  "D-analyse": '<path d="M6.6 2.4h6.6c.4 0 .78.16 1.06.44l4.4 4.4c.28.28.44.66.44 1.06v4.1a5.6 5.6 0 0 0-8 7.2H6.6a2.1 2.1 0 0 1-2.1-2.1V4.5c0-1.16.94-2.1 2.1-2.1z"/><circle cx="15.6" cy="16.6" r="3.3" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="m18.1 19.1 2.4 2.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  "E-prospection": '<circle cx="10.4" cy="10.4" r="6.1" fill="none" stroke="currentColor" stroke-width="2.7"/><path d="m15.1 15.1 5.6 5.6" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round"/>',
  "F-commercial": '<path d="M4.6 4.8h14.8A2.6 2.6 0 0 1 22 7.4v.4l-10 6.1L2 7.8v-.4a2.6 2.6 0 0 1 2.6-2.6z"/><path d="m2 10.2 9.48 5.78c.32.2.72.2 1.04 0L22 10.2v6.4a2.6 2.6 0 0 1-2.6 2.6H4.6A2.6 2.6 0 0 1 2 16.6z"/>',
  "G-controle": '<path fill-rule="evenodd" d="M11.6 2.3a1 1 0 0 1 .8 0l6.8 2.9c.37.16.6.52.6.92v5.3c0 4.7-3.05 8.75-7.45 10.3a1 1 0 0 1-.7 0C7.25 20.17 4.2 16.12 4.2 11.42v-5.3c0-.4.23-.76.6-.92zm4.25 7.25a1.05 1.05 0 0 0-1.6-1.35l-3.25 3.86-1.6-1.6a1.05 1.05 0 1 0-1.48 1.48l2.4 2.4c.43.43 1.14.4 1.53-.07z"/>',
  "H-comptable": '<rect x="3.4" y="12.2" width="4.4" height="8.6" rx="1.4"/><rect x="9.8" y="7.4" width="4.4" height="13.4" rx="1.4"/><rect x="16.2" y="3.2" width="4.4" height="17.6" rx="1.4"/>',
  "CLIENTS": '<circle cx="9" cy="7.9" r="3.7"/><path d="M2.4 19.2c0-3.35 2.95-5.7 6.6-5.7s6.6 2.35 6.6 5.7c0 .72-.56 1.3-1.25 1.3H3.65c-.69 0-1.25-.58-1.25-1.3z"/><circle cx="17" cy="8.5" r="2.9"/><path d="M16.9 13.4c2.85.12 4.8 2.05 4.8 4.75 0 .7-.55 1.25-1.22 1.25h-3.1c.18-.38.27-.8.27-1.24 0-1.86-.8-3.5-2.18-4.62.45-.1.92-.15 1.43-.14z"/>'
};
const icone = (code, taille = 26) => `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="currentColor" aria-hidden="true">${ICONES[code] || ""}</svg>`;

const nf = n => Number(n || 0).toLocaleString("fr-FR");
const jour = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const heure = d => d ? new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais";
const ilYa = j => new Date(Date.now() - j * 864e5).toISOString();

/* Prochain passage prévu d'un agent */
function prochaine(code) {
  const n = new Date(), d = new Date(n);
  if (code === "A-collecteur") { for (let i = 1; i <= 48; i++) { d.setTime(n.getTime()); d.setMinutes(0, 0, 0); d.setHours(n.getHours() + i); const h = d.getHours(); if (h >= 6 && h <= 20 && h % 2 === 0) return d; } }
  if (code === "B-tri") { for (let i = 0; i <= 7; i++) { d.setTime(n.getTime()); d.setDate(n.getDate() + i); d.setHours(6, 45, 0, 0); if (d > n && d.getDay() >= 1 && d.getDay() <= 5) return d; } }
  return null;
}

/* Santé d'un agent d'après son journal (runs triés du plus récent au plus ancien) */
function sante(ag, tousLesRuns) {
  if (ag.avenir) return { cle: "avenir", txt: "À construire (" + ag.avenir + ")", runs: [] };
  const runs = tousLesRuns.filter(r => r.agent === ag.code);
  const der = runs[0];
  if (!der) return { cle: "erreur", txt: "Jamais exécuté", runs };
  const heuresDepuis = (Date.now() - new Date(der.debut)) / 36e5;
  const now = new Date();
  const attendu = (!ag.jours || ag.jours.includes(now.getDay())) && (!ag.heures || (now.getHours() >= ag.heures[0] && now.getHours() < ag.heures[1]));
  if (der.statut === "erreur") return { cle: "erreur", txt: "En erreur", der, runs };
  if (attendu && heuresDepuis > ag.rythme) return { cle: "retard", txt: "En retard", der, runs };
  if (der.statut === "en_cours") return { cle: "ok", txt: "En cours d'exécution", der, runs };
  if (der.statut === "vide") return { cle: "vide", txt: "Actif, rien à faire", der, runs };
  return { cle: "ok", txt: "Actif", der, runs };
}
const estActif = e => e.cle === "ok" || e.cle === "vide";

/* Accès administrateur, commun aux deux pages */
async function verifierAdmin() {
  if (!SB) return { erreur: "Le site n'est pas relié à Supabase (config.js)." };
  const s = await Compte.session(); if (!s) return { erreur: null };
  const { data: moi } = await SB.from("profils").select("id,email,entreprise,est_admin").eq("id", s.user.id).single();
  if (!moi?.est_admin) { await Compte.deconnecter(); return { erreur: "Ce compte n'a pas les droits d'administrateur. Active-les dans Supabase (colonne est_admin de la table profils)." }; }
  return { moi };
}
