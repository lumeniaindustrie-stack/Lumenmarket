/* ===== Page « Analytique » du pilotage =====
   Données : fonction Supabase stats_pilotage(jours) + table abonnements_journal
   (supabase/supabase_analytics.sql) + profils déjà chargés dans D.            */
const AN = { periode: 90, data: null, journal: null, charge: 0, erreur: null, enCours: null };
const AN_C1 = "#2F6BF2", AN_C2 = "#0E9F8E";   // palette validée (CVD, contraste) : série 1, série 2
const AN_PERIODES = { 30: "30 jours", 90: "90 jours", 365: "12 mois" };

const anJour = d => new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });   // AAAA-MM-JJ, heure de Paris
const anPct = (a, b) => b ? Math.round(a / b * 100) : null;
const anEur = v => nf(Math.round(v)) + " €";
const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const anLabJour = s => { const [, m, j] = s.split("-"); return `${+j} ${MOIS_C[+m - 1]}`; };
const anLabMois = s => { const [a, m] = s.split("-"); return `${MOIS_C[+m - 1]} ${a.slice(2)}`; };

/* ---------- Chargement ---------- */
async function anCharger(force) {
  if (!force && AN.data && AN.data._p === AN.periode && Date.now() - AN.charge < 60000) return;
  if (AN.enCours) return AN.enCours;
  AN.enCours = (async () => {
    const [s, j] = await Promise.all([
      SB.rpc("stats_pilotage", { jours: AN.periode }),
      SB.from("abonnements_journal").select("client_id,evenement,le,estime").order("le").limit(20000)
    ]);
    AN.erreur = s.error || j.error || null;
    AN.data = s.data ? { ...s.data, _p: AN.periode } : null;
    AN.journal = j.error ? null : (j.data || []);
    AN.charge = Date.now();
  })();
  try { await AN.enCours; } finally { AN.enCours = null; }
}

/* ---------- Regroupement par jour / semaine / mois ---------- */
function anTranches(jours) {
  const n = jours.length, mode = n <= 31 ? "jour" : n <= 120 ? "semaine" : "mois", t = [];
  if (mode === "jour") jours.forEach((d, i) => t.push({ lab: anLabJour(d), titre: anLabJour(d), idx: [i] }));
  else if (mode === "semaine") {
    for (let f = n - 1; f >= 0; f -= 7) { const idx = []; for (let i = Math.max(0, f - 6); i <= f; i++) idx.push(i); t.unshift({ lab: anLabJour(jours[idx[0]]), titre: `Semaine du ${anLabJour(jours[idx[0]])}`, idx }); }
  } else jours.forEach((d, i) => { const m = d.slice(0, 7); if (!t.length || t[t.length - 1].m !== m) t.push({ m, lab: anLabMois(d), titre: anLabMois(d), idx: [] }); t[t.length - 1].idx.push(i); });
  t.mode = mode;
  return t;
}
const anSomme = (serie, T) => T.map(t => t.idx.reduce((s, i) => s + (Number(serie[i]) || 0), 0));
const anFin = (serie, T) => T.map(t => Number(serie[t.idx[t.idx.length - 1]]) || 0);

/* ---------- Graphique (barres / ligne / aire, un seul axe) ---------- */
function anPasRond(v) { const p = Math.pow(10, Math.floor(Math.log10(v))), r = v / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; }
function anGraphe(el, { T, series, h = 200, fmt = nf }) {
  if (!el) return;
  el.innerHTML = "";   // vider avant de mesurer : l'ancien graphique ne doit pas imposer sa largeur
  const W = Math.max(260, el.clientWidth || 600), n = T.length;
  const max = Math.max(0, ...series.flatMap(s => s.val));
  const entiers = series.every(s => s.val.every(Number.isInteger));
  const pas = max > 0 ? (entiers ? Math.max(1, anPasRond(max / 4)) : anPasRond(max / 4)) : 1, haut = Math.max(pas * 4, Math.ceil(max / pas) * pas);
  const ticks = []; for (let v = 0; v <= haut + 1e-9; v += pas) ticks.push(v);
  const gL = Math.max(28, Math.max(...ticks.map(v => fmt(v).length)) * 6.4 + 10), gR = 8, gT = 10, gB = 22;
  const iw = W - gL - gR, ih = h - gT - gB, bw = iw / n, y = v => gT + ih - v / haut * ih, xc = i => gL + bw * (i + .5);
  const barres = series.filter(s => s.type === "barre"), k = barres.length;
  const grp = Math.min(bw * .72, 15 * k + 2 * (k - 1)), bl = k ? (grp - 2 * (k - 1)) / k : 0;
  let svg = `<svg class="an-svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(series.map(s => s.nom).join(", "))}">`;
  ticks.forEach(v => { svg += `<line x1="${gL}" x2="${W - gR}" y1="${y(v)}" y2="${y(v)}" class="${v ? "an-quad" : "an-base"}"/><text x="${gL - 7}" y="${y(v) + 3.5}" text-anchor="end" class="an-axe">${esc(fmt(v))}</text>`; });
  const tous = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 62))));
  T.forEach((t, i) => { if ((n - 1 - i) % tous === 0) svg += `<text x="${xc(i)}" y="${h - 6}" text-anchor="middle" class="an-axe">${esc(t.lab)}</text>`; });
  barres.forEach((s, b) => s.val.forEach((v, i) => {
    if (!v) return;
    const x = xc(i) - grp / 2 + b * (bl + 2), yy = y(v), r = Math.min(4, bl / 2, (gT + ih - yy));
    svg += `<path d="M${x} ${gT + ih}V${yy + r}Q${x} ${yy} ${x + r} ${yy}H${x + bl - r}Q${x + bl} ${yy} ${x + bl} ${yy + r}V${gT + ih}Z" fill="${s.coul}"/>`;
  }));
  series.filter(s => s.type !== "barre").forEach((s, j) => {
    const pts = s.val.map((v, i) => [xc(i), y(v)]), d = "M" + pts.map(p => p.join(" ")).join("L");
    if (s.type === "aire") svg += `<defs><linearGradient id="ang${j}${el.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.coul}" stop-opacity=".22"/><stop offset="1" stop-color="${s.coul}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${pts[n - 1][0]} ${gT + ih}L${pts[0][0]} ${gT + ih}Z" fill="url(#ang${j}${el.id})"/>`;
    svg += `<path d="${d}" fill="none" stroke="${s.coul}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const [lx, ly] = pts[n - 1]; svg += `<circle cx="${lx}" cy="${ly}" r="4" fill="${s.coul}" stroke="#fff" stroke-width="2"/>`;
  });
  svg += `<line class="an-guide" x1="0" x2="0" y1="${gT}" y2="${gT + ih}" visibility="hidden"/><g class="an-points"></g>`;
  svg += `<rect class="an-zone" x="${gL}" y="${gT}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  const vide = max === 0 ? `<p class="an-vide-graphe">Aucune donnée sur la période</p>` : "";
  const legende = series.length > 1 ? `<div class="an-legende">${series.map(s => `<span><i class="${s.type === "barre" ? "carre" : "trait"}" style="background:${s.coul}"></i>${esc(s.nom)}</span>`).join("")}</div>` : "";
  el.innerHTML = legende + `<div class="an-trace">${svg}${vide}<div class="an-tip" hidden></div></div>`;

  // survol : repère vertical + infobulle avec toutes les séries
  const zone = $(".an-zone", el), tip = $(".an-tip", el), guide = $(".an-guide", el), gp = $(".an-points", el), trace = $(".an-trace", el);
  const montrer = ev => {
    const r = zone.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left) / (r.width / n))));
    guide.setAttribute("x1", xc(i)); guide.setAttribute("x2", xc(i)); guide.setAttribute("visibility", "visible");
    gp.innerHTML = series.filter(s => s.type !== "barre").map(s => `<circle cx="${xc(i)}" cy="${y(s.val[i])}" r="4" fill="${s.coul}" stroke="#fff" stroke-width="2"/>`).join("");
    tip.innerHTML = `<b>${esc(T[i].titre)}</b>` + series.map(s => `<span><i style="background:${s.coul}"></i>${esc(s.nom)}<strong>${esc(fmt(s.val[i]))}</strong></span>`).join("");
    tip.hidden = false;
    const tw = tip.offsetWidth, x = xc(i) + 12 + tw > W ? xc(i) - 12 - tw : xc(i) + 12;
    tip.style.left = x + "px"; tip.style.top = (gT + 4) + "px";
  };
  zone.addEventListener("mousemove", montrer);
  zone.addEventListener("mouseleave", () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); gp.innerHTML = ""; });
  trace.dataset.n = n;
}
function anTable(T, series, fmt = nf) {
  return `<details class="an-donnees"><summary>Voir les données</summary><div class="tableau"><table><thead><tr><th>Période</th>${series.map(s => `<th>${esc(s.nom)}</th>`).join("")}</tr></thead>
    <tbody>${T.map((t, i) => `<tr><td>${esc(t.titre)}</td>${series.map(s => `<td>${esc(fmt(s.val[i]))}</td>`).join("")}</tr>`).reverse().join("")}</tbody></table></div></details>`;
}

/* ---------- Calculs clients / rétention ---------- */
function anClients() {
  const auj = anJour(new Date()), P = CFG.PRIX || 99;
  const clients = D.profils.filter(p => !p.est_admin);
  const paie = p => p.actif !== false && (p.formule || "essai") !== "essai";
  const payants = clients.filter(paie);
  const ev = (AN.journal || []).map(e => ({ ...e, d: anJour(e.le) }));
  const deja = new Set(ev.filter(e => e.evenement === "abonnement").map(e => e.client_id));
  payants.forEach(p => deja.add(p.id));
  const essaiFini = p => deja.has(p.id) || (p.fin_essai && p.fin_essai < auj) || p.actif === false;
  // durée cumulée d'abonnement par client (jours)
  const duree = {};
  const ouvert = {};
  ev.forEach(e => {
    if (e.evenement === "abonnement") ouvert[e.client_id] = e.le;
    else if (ouvert[e.client_id]) { duree[e.client_id] = (duree[e.client_id] || 0) + (new Date(e.le) - new Date(ouvert[e.client_id])) / 864e5; delete ouvert[e.client_id]; }
  });
  Object.entries(ouvert).forEach(([id, le]) => { duree[id] = (duree[id] || 0) + (Date.now() - new Date(le)) / 864e5; });
  const durees = Object.values(duree);
  return { auj, P, clients, payants, paie, ev, deja, essaiFini, dureeMoy: durees.length ? durees.reduce((a, b) => a + b, 0) / durees.length : null };
}
// nombre de clients payants à la fin de chaque jour (d'après le journal ; sinon valeur actuelle)
function anPayantsParJour(jours, C) {
  if (!AN.journal) return jours.map(() => C.payants.length);
  let i = 0, n = 0; const ev = C.ev;
  return jours.map(d => { while (i < ev.length && ev[i].d <= d) { n += ev[i].evenement === "abonnement" ? 1 : -1; i++; } return Math.max(0, n); });
}

/* ---------- Rendu de la page ---------- */
function anTuile(lab, val, sous, cl = "") { return `<div class="an-tuile"><span>${lab}</span><strong>${val}</strong><small class="${cl}">${sous}</small></div>`; }
function anVariation(a, b, fmt = nf) { const d = a - b; return { txt: d ? `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))} sur la période` : "stable sur la période", cl: d > 0 ? "up" : d < 0 ? "dn" : "" }; }

async function rendreAnalytics(force) {
  $$("#an-periode button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.p === AN.periode)));
  $("#an-maj").textContent = "Chargement…";
  try { await anCharger(force); } catch (e) { AN.erreur = e; }
  const S = AN.data, C = anClients();
  $("#an-maj").textContent = "Actualisé à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const etat = $("#an-etat");
  if (!S) {
    etat.hidden = false;
    etat.innerHTML = `<b>Les graphiques ne sont pas encore activés.</b> Exécute le fichier <code>supabase/supabase_analytics.sql</code> dans Supabase (SQL Editor &gt; New query &gt; Run), puis actualise.
      <small>Détail : ${esc(AN.erreur?.message || "fonction stats_pilotage introuvable")}</small>`;
    $("#an-contenu").hidden = true;
    return;
  }
  etat.hidden = true; $("#an-contenu").hidden = false;

  const J = S.jours, T = anTranches(J), P = C.P, deb = J[0];
  const pay = anPayantsParJour(J, C), mrr = pay.map(v => v * P);
  const encaisse = S.paiements.map(v => v * P);
  const insPeriode = C.clients.filter(p => anJour(p.cree_le) >= deb);
  const evP = C.ev.filter(e => e.d >= deb);
  const resil = evP.filter(e => e.evenement === "resiliation").length;
  const payDebut = AN.journal ? (pay[0] - evP.filter(e => e.d === deb).reduce((s, e) => s + (e.evenement === "abonnement" ? 1 : -1), 0)) : null;
  const finis = C.clients.filter(C.essaiFini), convertis = finis.filter(p => C.deja.has(p.id));
  const stock = []; S.offres_collectees.reduce((s, v, i) => (stock[i] = s + v), Number(S.offres_avant) || 0);
  const somme = a => a.reduce((x, y) => x + (Number(y) || 0), 0);
  const lib = AN_PERIODES[AN.periode];

  // ---- Tuiles ----
  const vM = anVariation(mrr[mrr.length - 1], payDebut != null ? payDebut * P : mrr[0], anEur), vP = anVariation(pay[pay.length - 1], payDebut ?? pay[0]);
  $("#an-tuiles").innerHTML = [
    anTuile("Revenu mensuel récurrent", anEur(mrr[mrr.length - 1]), vM.txt, vM.cl),
    anTuile("Clients payants", nf(pay[pay.length - 1]), vP.txt, vP.cl),
    anTuile(`Encaissé (${lib})`, anEur(somme(encaisse)), `${nf(somme(S.paiements))} paiement${somme(S.paiements) > 1 ? "s" : ""} Stripe`),
    anTuile(`Nouveaux clients (${lib})`, nf(insPeriode.length), `dont ${nf(insPeriode.filter(p => C.deja.has(p.id)).length)} passés payants`),
    anTuile("Conversion essai → payant", anPct(convertis.length, finis.length) != null ? anPct(convertis.length, finis.length) + " %" : "–", `${nf(convertis.length)} sur ${nf(finis.length)} essai${finis.length > 1 ? "s" : ""} terminé${finis.length > 1 ? "s" : ""}`),
    anTuile(`Résiliations (${lib})`, nf(resil), payDebut ? `churn ${anPct(resil, Math.max(payDebut, 1))} % des abonnés` : "aucun abonné en début de période", resil ? "dn" : ""),
    anTuile("Offres en base", nf(S.offres_total), `+${nf(somme(S.offres_collectees))} collectées · ${nf(S.offres_ouvertes[S.offres_ouvertes.length - 1])} ouvertes`),
    anTuile(`Emails de prospection (${lib})`, nf(somme(S.prospection_envoyes)), `${nf(S.prospection_inscrits)} entreprise${S.prospection_inscrits > 1 ? "s" : ""} inscrite${S.prospection_inscrits > 1 ? "s" : ""} au total`)
  ].join("");

  // ---- Revenu ----
  const sMrr = { nom: "Revenu mensuel récurrent", val: anFin(mrr, T), type: "aire", coul: AN_C1 };
  const sEnc = { nom: "Encaissé (Stripe)", val: anSomme(encaisse, T), type: "barre", coul: AN_C1 };
  $("#an-revenu-corps").innerHTML = `<div class="an-g" id="an-g-mrr"></div><h3>Encaissé par ${T.mode === "jour" ? "jour" : T.mode}</h3><div class="an-g" id="an-g-enc"></div>
    <p class="an-note">Revenu mensuel récurrent = clients payants × ${P} € HT. « Encaissé » = paiements confirmés par Stripe (agent H).${AN.journal && AN.journal.some(e => e.estime) ? " Pour les clients déjà abonnés avant l'activation de cette page, la date de début d'abonnement est estimée." : ""}</p>`
    + anTable(T, [sMrr, sEnc], anEur);
  anGraphe($("#an-g-mrr"), { T, series: [sMrr], fmt: anEur });
  anGraphe($("#an-g-enc"), { T, series: [sEnc], h: 130, fmt: anEur });

  // ---- Clients ----
  const sPay = { nom: "Clients payants", val: anFin(pay, T), type: "aire", coul: AN_C1 };
  const sIns = { nom: "Nouvelles inscriptions", val: anSomme(S.inscriptions, T), type: "barre", coul: AN_C1 };
  $("#an-clients-corps").innerHTML = `<div class="an-g" id="an-g-pay"></div><h3>Nouvelles inscriptions</h3><div class="an-g" id="an-g-ins"></div>` + anTable(T, [sPay, sIns]);
  anGraphe($("#an-g-pay"), { T, series: [sPay] });
  anGraphe($("#an-g-ins"), { T, series: [sIns], h: 130 });

  // ---- Rétention ----
  const etapes = [["Inscrits", C.clients.length], ["Essai terminé", finis.length], ["Devenus payants", C.deja.size], ["Toujours payants", C.payants.length]];
  const nbMois = AN.periode <= 30 ? 3 : AN.periode <= 90 ? 6 : 12, now = new Date(), cohortes = [];
  for (let m = nbMois - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1), cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const g = C.clients.filter(p => anJour(p.cree_le).slice(0, 7) === cle);
    const actifs = g.filter(p => p.actif !== false && (C.paie(p) || !p.fin_essai || p.fin_essai >= C.auj));
    cohortes.push({ lab: anLabMois(cle + "-01"), n: g.length, actifs: actifs.length, devenus: g.filter(p => C.deja.has(p.id)).length, payants: g.filter(C.paie).length });
  }
  const cell = (v, n) => { const p = anPct(v, n); return p == null ? `<td class="an-c">–</td>` : `<td class="an-c" style="--a:${(0.06 + p / 100 * 0.5).toFixed(2)}"><b>${p} %</b><small>${nf(v)}</small></td>`; };
  const max0 = Math.max(1, etapes[0][1]);
  $("#an-retention-corps").innerHTML = `
    <div class="an-ret">
      <div>
        <h3>Du premier essai à l'abonnement</h3>
        <div class="an-entonnoir">${etapes.map(([l, v], i) => `<div class="an-etape"><span>${l}</span><div class="an-barre"><i style="width:${Math.max(v ? 2 : 0, v / max0 * 100)}%"></i></div><b>${nf(v)}</b><small>${i ? (anPct(v, etapes[i - 1][1]) ?? "–") + (anPct(v, etapes[i - 1][1]) != null ? " %" : "") : ""}</small></div>`).join("")}</div>
        <div class="an-mini">
          <div><span>Durée moyenne d'abonnement</span><b>${C.dureeMoy != null ? (C.dureeMoy / 30.44 < 1 ? Math.round(C.dureeMoy) + " j" : (C.dureeMoy / 30.44).toFixed(1).replace(".", ",") + " mois") : "–"}</b></div>
          <div><span>Abonnés toujours là</span><b>${anPct(C.payants.length, C.deja.size) != null ? anPct(C.payants.length, C.deja.size) + " %" : "–"}</b></div>
          <div><span>Valeur moyenne d'un client</span><b>${C.dureeMoy != null ? anEur(C.dureeMoy / 30.44 * P) : "–"}</b></div>
        </div>
      </div>
      <div>
        <h3>Rétention par mois d'inscription</h3>
        <div class="tableau"><table class="an-cohortes"><thead><tr><th>Inscrits en</th><th>Inscrits</th><th>Encore actifs</th><th>Devenus payants</th><th>Toujours payants</th></tr></thead>
          <tbody>${cohortes.reverse().map(c => `<tr><td>${esc(c.lab)}</td><td>${nf(c.n)}</td>${cell(c.actifs, c.n)}${cell(c.devenus, c.n)}${cell(c.payants, c.n)}</tr>`).join("")}</tbody></table></div>
        <p class="an-note">« Encore actifs » : en essai en cours ou abonnés. Plus la case est foncée, plus la part est élevée.</p>
      </div>
    </div>`;

  // ---- Offres stockées ----
  const sStock = { nom: "Offres en base", val: anFin(stock, T), type: "ligne", coul: AN_C1 };
  const sOuv = { nom: "Encore ouvertes", val: anFin(S.offres_ouvertes, T), type: "ligne", coul: AN_C2 };
  const sCol = { nom: "Offres collectées", val: anSomme(S.offres_collectees, T), type: "barre", coul: AN_C1 };
  $("#an-offres-corps").innerHTML = `<div class="an-g" id="an-g-stock"></div><h3>Collectées par ${T.mode === "jour" ? "jour" : T.mode}</h3><div class="an-g" id="an-g-col"></div>` + anTable(T, [sStock, sOuv, sCol]);
  anGraphe($("#an-g-stock"), { T, series: [sStock, sOuv] });
  anGraphe($("#an-g-col"), { T, series: [sCol], h: 130 });

  // ---- Offres envoyées ----
  const sEnv = { nom: "Offres envoyées", val: anSomme(S.offres_envoyees, T), type: "barre", coul: AN_C1 };
  const totEnv = somme(S.offres_envoyees), joursServis = S.clients_servis.filter(Boolean).length;
  $("#an-envoyees-corps").innerHTML = `<div class="an-mini an-mini-haut"><div><span>Total (${lib})</span><b>${nf(totEnv)}</b></div><div><span>Clients servis / jour</span><b>${joursServis ? (somme(S.clients_servis) / joursServis).toFixed(1).replace(".", ",") : "–"}</b></div><div><span>Offres par client servi</span><b>${somme(S.clients_servis) ? (totEnv / somme(S.clients_servis)).toFixed(1).replace(".", ",") : "–"}</b></div></div>
    <div class="an-g" id="an-g-env"></div>` + anTable(T, [sEnv]);
  anGraphe($("#an-g-env"), { T, series: [sEnv] });

  // ---- Prospection ----
  const sTr = { nom: "Entreprises trouvées (F)", val: anSomme(S.prospection_trouvees, T), type: "barre", coul: AN_C2 };
  const sPe = { nom: "Emails envoyés (K)", val: anSomme(S.prospection_envoyes, T), type: "barre", coul: AN_C1 };
  const ent = [["Entreprises trouvées", S.prospection_total_trouvees], ["Contactées", S.prospection_total_envoyes], ["Inscrites ensuite", S.prospection_inscrits], ["Devenues payantes", S.prospection_payants]];
  const maxE = Math.max(1, ent[0][1]);
  $("#an-prospection-corps").innerHTML = `<div class="an-g" id="an-g-pro"></div>
    <h3>Entonnoir de prospection (depuis le début)</h3>
    <div class="an-entonnoir">${ent.map(([l, v], i) => `<div class="an-etape"><span>${l}</span><div class="an-barre"><i style="width:${Math.max(v ? 2 : 0, v / maxE * 100)}%"></i></div><b>${nf(v)}</b><small>${i && anPct(v, ent[i - 1][1]) != null ? anPct(v, ent[i - 1][1]) + " %" : ""}</small></div>`).join("")}</div>
    <p class="an-note">${nf(S.prospection_a_contacter)} entreprise${S.prospection_a_contacter > 1 ? "s" : ""} avec un email vérifié attendent d'être contactées. Une inscription est attribuée à la prospection quand le SIREN du client correspond à une entreprise contactée avant son inscription.</p>`
    + anTable(T, [sTr, sPe]);
  anGraphe($("#an-g-pro"), { T, series: [sTr, sPe] });

  // ---- Dossiers analysés & demandes ----
  const sAn = { nom: "Dossiers analysés", val: anSomme(S.analyses, T), type: "barre", coul: AN_C1 };
  const sDe = { nom: "Demandes sur mesure", val: anSomme(S.demandes, T), type: "barre", coul: AN_C1 };
  $("#an-analyses-corps").innerHTML = `<div class="an-g" id="an-g-an"></div><h3>Demandes sur mesure (diagnostic, IA locale…)</h3><div class="an-g" id="an-g-de"></div>` + anTable(T, [sAn, sDe]);
  anGraphe($("#an-g-an"), { T, series: [sAn] });
  anGraphe($("#an-g-de"), { T, series: [sDe], h: 130 });
  AN.dernierRendu = { T };
}

/* ---------- Navigation ---------- */
function ouvrirAnalytics(cible) {
  aller("analytics");
  const go = () => { const el = cible && document.getElementById(cible); if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.remove("an-flash"); void el.offsetWidth; el.classList.add("an-flash"); };
  (AN.enCours || Promise.resolve()).then(() => setTimeout(go, 60));
}
$$("#an-periode button").forEach(b => b.onclick = () => { AN.periode = +b.dataset.p; rendreAnalytics(true); });
$("#an-rafraichir").onclick = async () => { const b = $("#an-rafraichir"); b.classList.add("tourne"); try { await charger(); await rendreAnalytics(true); } finally { b.classList.remove("tourne"); } };
let anResize;
window.addEventListener("resize", () => { clearTimeout(anResize); anResize = setTimeout(() => { if ($("#v-analytics").classList.contains("on") && AN.data) rendreAnalytics(false); }, 200); });
