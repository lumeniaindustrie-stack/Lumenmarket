/* Lumen Pilotage : page « Contrôle » — pilote le PC (n8n, Ollama, agents) via la télécommande locale
   installée par windows/installer_lumen.ps1 (http://localhost:5680). Fonctionne uniquement quand le
   pilotage est ouvert sur le PC qui fait tourner les agents. */
const TELECOMMANDE = "http://localhost:5680";
const CT = { joignable: null, etat: null, minuteur: null, occupe: {} };

// Agents lançables à la main (H réagit aux paiements Stripe : pas de lancement manuel)
const CT_ATTENTION = {
  "B-tri": "envoie les offres du jour par email à tes clients",
  "K-prospection": "envoie de vrais emails de prospection (10 par jour au plus)",
  "G-controle": "peut t'envoyer un email d'alerte",
  "I-inscriptions": "t'envoie un email par nouvelle inscription",
  "L-relances": "envoie de vraies relances aux prospects"
};
function ctAgents() {
  const liste = AGENTS.filter(a => a.code !== "H-comptable").map(a => ({ code: a.code, nom: a.nom, titre: a.titre, pole: a.pole }));
  if (!liste.some(a => a.code === "I-inscriptions")) liste.splice(7, 0, { code: "I-inscriptions", nom: "Agent I", titre: "Alerte inscription", pole: "Pôle commercial" });
  return liste;
}

async function ctFetch(chemin, methode = "GET") {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(TELECOMMANDE + chemin, { method: methode, signal: ctrl.signal, cache: "no-store" });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function ctRafraichir() {
  try { CT.etat = await ctFetch("/etat"); CT.joignable = true; }
  catch (e) { CT.joignable = false; CT.etat = null; }
  ctDessiner();
}

function ctPill(ok, txtOk, txtKo, attente) {
  if (attente) return `<span class="tag att">${attente}</span>`;
  return ok ? `<span class="tag ok">${txtOk}</span>` : `<span class="tag ko">${txtKo}</span>`;
}

function ctDernier(code) {
  const r = D.runs.find(x => x.agent === code);
  if (!r) return `<span class="muted">Aucun passage en 30 jours</span>`;
  const d = new Date(r.debut);
  const quand = d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const cls = r.statut === "erreur" ? "ko" : r.statut === "ok" ? "ok" : "";
  return `<span class="tag ${cls}">${esc(r.statut)}</span> <span class="muted">${esc(quand)}</span>`;
}

function ctDessiner() {
  const e = CT.etat;
  const bandeau = $("#ct-bandeau");
  if (CT.joignable === false) {
    bandeau.hidden = false;
    bandeau.innerHTML = `<b>La télécommande du PC ne répond pas.</b> Cette page ne fonctionne que sur le PC qui fait tourner les agents, une fois la télécommande installée :
      ouvre le dossier <code>Lument_agents\\Windows</code>, clic droit sur <code>installer_lumen.ps1</code> puis « Exécuter avec PowerShell ». Si le PC est éteint ou en veille, rien ne peut être piloté d'ici.`;
  } else bandeau.hidden = true;

  // ---- Services ----
  const n8n = e?.n8n || {}, ol = e?.ollama || {};
  const occ = CT.occupe;
  const n8nAttente = occ.n8n ? (occ.n8n === "demarrer" ? "Démarrage…" : "Arrêt…") : (n8n.actif && !n8n.pret ? "Démarrage…" : null);
  const olAttente = occ.ollama ? (occ.ollama === "demarrer" ? "Démarrage…" : "Arrêt…") : null;
  const dis = !CT.joignable ? "disabled" : "";
  $("#ct-services").innerHTML = `
    <div class="ct-svc">
      <div class="ct-svc-tete"><b>n8n</b>${CT.joignable ? ctPill(n8n.actif, "En marche", n8n.pause ? "Arrêté (par toi)" : "Arrêté", n8nAttente) : '<span class="tag">Inconnu</span>'}</div>
      <p class="muted">Fait tourner tous les agents. Arrêté, plus aucun agent ne travaille : ni collecte, ni tri, ni emails, ni chat client.</p>
      <div class="ct-actions">${n8n.actif
        ? `<button class="btn ct-danger" data-svc="n8n" data-act="arreter" ${dis}>Arrêter n8n</button>`
        : `<button class="btn prim" data-svc="n8n" data-act="demarrer" ${dis}>Démarrer n8n</button>`}</div>
    </div>
    <div class="ct-svc">
      <div class="ct-svc-tete"><b>Ollama</b>${CT.joignable ? ctPill(ol.actif, "En marche", ol.pause ? "Arrêté (par toi)" : "Arrêté", olAttente) : '<span class="tag">Inconnu</span>'}</div>
      <p class="muted">IA locale, aujourd'hui seulement en secours si OpenAI ne répond pas (agents B, C, D). C'est elle qui fait le plus chauffer le PC.
      ${ol.modeles_charges && ol.modeles_charges.length ? `<br>Modèle en mémoire : <b>${esc(ol.modeles_charges.join(", "))}</b>` : ""}</p>
      <div class="ct-actions">${ol.actif
        ? `<button class="btn ct-danger" data-svc="ollama" data-act="arreter" ${dis}>Arrêter Ollama</button>`
        : `<button class="btn prim" data-svc="ollama" data-act="demarrer" ${dis}>Démarrer Ollama</button>`}</div>
    </div>`;

  // ---- Agents ----
  const ex = e?.executions || {}, wf = e?.workflows || {};
  $("#ct-agents").innerHTML = ctAgents().map(a => {
    const x = ex[a.code];
    const lettre = a.code.split("-")[0];
    let etat = "";
    if (x && x.en_cours) etat = `<span class="tag att">En cours depuis ${esc(new Date(x.debut).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))}</span>`;
    else if (x && x.fin) etat = x.reussi ? `<span class="tag ok">Terminé à ${esc(new Date(x.fin).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))}</span>`
      : `<span class="tag ko" title="${esc(x.detail || "")}">Échec, voir le journal</span>`;
    const absent = CT.joignable && e?.workflows_lus && !wf[lettre];
    const double = CT.joignable && (wf[lettre] || 0) > 1;
    const note = absent ? `<small class="ct-alerte">Introuvable dans n8n</small>` : double ? `<small class="ct-alerte">${wf[lettre]} workflows « ${esc(a.nom)} » dans n8n : supprime l'ancien</small>` : "";
    const att = CT_ATTENTION[a.code];
    const peut = CT.joignable && e?.n8n?.actif && !(x && x.en_cours) && !absent && !double && !CT.occupe[a.code];
    return `<tr>
      <td><b>${esc(a.nom)}</b> · ${esc(a.titre)}<br><span class="muted">${esc(a.pole)}</span>${note}</td>
      <td>${ctDernier(a.code)}</td>
      <td>${etat}</td>
      <td class="ct-lancer"><button class="btn sm ${att ? "" : "prim"}" data-agent="${esc(a.code)}" ${peut ? "" : "disabled"} ${att ? `data-attention="${esc(att)}"` : ""}>${CT.occupe[a.code] ? "Lancement…" : "Lancer"}</button></td>
    </tr>`;
  }).join("");
}

async function ctService(svc, act, bouton) {
  if (act === "arreter" && !bouton.classList.contains("confirmer")) {
    bouton.classList.add("confirmer"); bouton.textContent = "Confirmer l'arrêt ?";
    setTimeout(() => { if (bouton.isConnected && bouton.classList.contains("confirmer")) ctDessiner(); }, 4000);
    return;
  }
  CT.occupe[svc] = act; ctDessiner();
  try { await ctFetch(`/${svc}/${act}`, "POST"); } catch (e) { alerteCt("La télécommande n'a pas répondu."); }
  // n8n met 30 à 90 s à démarrer : on surveille un moment
  const fin = Date.now() + (svc === "n8n" && act === "demarrer" ? 120000 : 15000);
  const verifier = async () => {
    await ctRafraichir();
    const s = CT.etat?.[svc];
    const fait = s && (act === "demarrer" ? (svc === "n8n" ? s.pret : s.actif) : !s.actif);
    if (fait || Date.now() > fin) { delete CT.occupe[svc]; ctDessiner(); return; }
    setTimeout(verifier, 3000);
  };
  setTimeout(verifier, 2500);
}

async function ctLancer(code, bouton) {
  if (bouton.dataset.attention && !bouton.classList.contains("confirmer")) {
    bouton.classList.add("confirmer"); bouton.textContent = "Confirmer ?"; bouton.title = "Attention : cet agent " + bouton.dataset.attention;
    setTimeout(() => { if (bouton.isConnected && bouton.classList.contains("confirmer")) ctDessiner(); }, 5000);
    return;
  }
  CT.occupe[code] = true; ctDessiner();
  let r;
  try { r = await ctFetch(`/agent/lancer?code=${encodeURIComponent(code)}`, "POST"); }
  catch (e) { r = { ok: false, message: "La télécommande n'a pas répondu." }; }
  delete CT.occupe[code];
  alerteCt(r.ok ? `${r.message}. Le résultat apparaîtra dans le journal (colonne « Dernier passage ») à la fin du passage.` : r.message, r.ok);
  await ctRafraichir();
}

function alerteCt(txt, ok) {
  const el = $("#ct-message");
  el.hidden = false; el.className = "ct-message " + (ok ? "ok" : "ko"); el.textContent = txt;
  clearTimeout(alerteCt.t); alerteCt.t = setTimeout(() => { el.hidden = true; }, 9000);
}

document.addEventListener("click", ev => {
  const b = ev.target.closest("#v-controle button"); if (!b || b.disabled) return;
  if (b.dataset.svc) ctService(b.dataset.svc, b.dataset.act, b);
  else if (b.dataset.agent) ctLancer(b.dataset.agent, b);
  else if (b.id === "ct-rafraichir") { ctRafraichir(); if (typeof charger === "function") charger().then(() => ctDessiner()); }
});

// Suivi automatique tant que la page est ouverte
function ctOuvrir() {
  ctRafraichir();
  clearInterval(CT.minuteur);
  CT.minuteur = setInterval(() => { if ($("#v-controle").classList.contains("on") && !document.hidden) ctRafraichir(); else clearInterval(CT.minuteur); }, 5000);
}
