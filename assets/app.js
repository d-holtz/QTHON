import { db, money, num, sortBoard, withRanks } from "./db.js";

const el = (id) => document.getElementById(id);
const board = el("board");
const searchBox = el("search");

let rows = [];
let settings = null;
let filter = "";
let previousPoints = new Map();

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setLive(ok, text) {
  const node = el("live");
  node.classList.toggle("stale", !ok);
  el("live-text").textContent = text;
}

async function loadSettings() {
  const { data, error } = await db.from("event_settings").select("*").single();
  if (error || !data) return;
  settings = data;
  document.title = `Live Leaderboard — ${data.event_name}`;
  el("event-name").textContent = data.event_name;
  el("tagline").textContent = data.tagline;
  el("pricing").textContent =
    `${money(data.price_single_cents)} a throw · ${data.bundle_throws} throws for ${money(data.bundle_cents)}`;
  renderGoal();
}

async function loadBoard() {
  const { data, error } = await db.from("leaderboard").select("*");
  if (error) {
    setLive(false, "Reconnecting");
    return;
  }
  rows = sortBoard(data || []);
  setLive(true, "Live");
  render();
}

function totals() {
  return rows.reduce(
    (acc, r) => {
      acc.raised += r.amount_cents;
      acc.throws += r.throws;
      if (r.rounds > 0) acc.players += 1;
      acc.top = Math.max(acc.top, r.points);
      return acc;
    },
    { raised: 0, throws: 0, players: 0, top: 0 }
  );
}

function renderGoal() {
  const { raised } = totals();
  const goal = settings?.goal_cents || 0;
  if (!goal) {
    el("goal-wrap").classList.add("hidden");
    return;
  }
  el("goal-wrap").classList.remove("hidden");
  el("goal-fill").style.width = `${Math.min(100, (raised / goal) * 100).toFixed(1)}%`;
  el("goal-now").textContent = `${money(raised)} raised`;
  el("goal-target").textContent = `Goal ${money(goal)}`;
}

function render() {
  const t = totals();
  el("stat-raised").textContent = money(t.raised);
  el("stat-players").textContent = num(t.players);
  el("stat-throws").textContent = num(t.throws);
  el("stat-top").textContent = num(t.top);
  renderGoal();

  // Ranks come from the whole field, so searching never changes someone's place.
  const ranked = withRanks(rows.filter((r) => r.rounds > 0));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? ranked.filter((r) => r.name.toLowerCase().includes(needle)) : ranked;

  if (!shown.length) {
    board.innerHTML = `<div class="empty">${
      needle ? "No one by that name yet." : "No scores yet — be the first on the board."
    }</div>`;
    return;
  }

  board.innerHTML = shown
    .map((r) => {
      const medal = r.rank <= 3 && !needle ? ` top${r.rank}` : "";
      const moved = previousPoints.has(r.id) && previousPoints.get(r.id) !== r.points;
      const detail = `${num(r.throws)} throw${r.throws === 1 ? "" : "s"} · ${r.rounds} round${r.rounds === 1 ? "" : "s"}`;
      return `<div class="row${medal}${moved ? " flash" : ""}">
        <div class="rank">${r.rank}</div>
        <div class="name">${escape(r.name)}<span class="sub">${detail}</span></div>
        <div class="points">${num(r.points)}</div>
        <div class="money">${money(r.amount_cents)}</div>
      </div>`;
    })
    .join("");

  previousPoints = new Map(rows.map((r) => [r.id, r.points]));
}

searchBox.addEventListener("input", (e) => {
  filter = e.target.value;
  render();
});

// TV mode: big rows for a screen at the table. Survives reloads and ?tv=1.
const tvOn = (on) => {
  document.body.classList.toggle("tv", on);
  el("tv-toggle").textContent = on ? "Exit TV mode" : "TV mode";
  localStorage.setItem("tv", on ? "1" : "0");
};
el("tv-toggle").addEventListener("click", () => tvOn(!document.body.classList.contains("tv")));
tvOn(new URLSearchParams(location.search).has("tv") || localStorage.getItem("tv") === "1");

// Live updates, plus a slow poll so the board self-heals if the socket drops.
db.channel("board")
  .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, loadBoard)
  .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, loadBoard)
  .on("postgres_changes", { event: "*", schema: "public", table: "event_settings" }, loadSettings)
  .subscribe((status) => {
    if (status === "SUBSCRIBED") setLive(true, "Live");
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLive(false, "Reconnecting");
  });

setInterval(loadBoard, 25000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadBoard(); });

await loadSettings();
await loadBoard();
