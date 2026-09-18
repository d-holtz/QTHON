import { db, money, num } from "./db.js";

const el = (id) => document.getElementById(id);
const show = (node, on) => node.classList.toggle("hidden", !on);

let settings = null;
let players = [];
let editingEntryId = null;

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer;
function toast(msg, isError = false) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.toggle("err", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

const dollars = (cents) => (cents / 100).toFixed(2);
const toCents = (value) => Math.round(Number(value || 0) * 100);

// What a given number of throws costs at the event's pricing.
function priceFor(throwCount) {
  if (!settings) return 0;
  const bundles = Math.floor(throwCount / settings.bundle_throws);
  const rest = throwCount % settings.bundle_throws;
  return bundles * settings.bundle_cents + rest * settings.price_single_cents;
}

/* ---------------- auth ---------------- */

async function refreshAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    show(el("login-card"), true);
    show(el("denied-card"), false);
    show(el("app"), false);
    show(el("signout"), false);
    el("who").textContent = "Sign in to enter scores.";
    return;
  }

  const { data: adminRow } = await db.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
  const isAdmin = Boolean(adminRow);

  show(el("login-card"), false);
  show(el("signout"), true);
  show(el("denied-card"), !isAdmin);
  show(el("app"), isAdmin);
  el("uid").value = session.user.id;
  el("who").textContent = isAdmin ? `Signed in as ${session.user.email}` : "Signed in — no edit access";

  if (isAdmin) await loadAll();
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({ email: el("email").value.trim(), password: el("password").value });
  if (error) return toast(error.message, true);
  await refreshAuth();
});

el("signup").addEventListener("click", async () => {
  const email = el("email").value.trim();
  const password = el("password").value;
  if (!email || password.length < 8) return toast("Enter an email and a password of at least 8 characters.", true);
  const { error } = await db.auth.signUp({ email, password });
  if (error) return toast(error.message, true);
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) return toast("Account created. Check your email to confirm it, then sign in.", true);
  await refreshAuth();
});

el("signout").addEventListener("click", async () => {
  await db.auth.signOut();
  await refreshAuth();
});

/* ---------------- data ---------------- */

async function loadSettings() {
  const { data } = await db.from("event_settings").select("*").single();
  settings = data;
  if (!settings) return;
  el("s-name").value = settings.event_name;
  el("s-tagline").value = settings.tagline;
  el("s-goal").value = Math.round(settings.goal_cents / 100);
  el("s-single").value = dollars(settings.price_single_cents);
  el("s-bthrows").value = settings.bundle_throws;
  el("s-bprice").value = dollars(settings.bundle_cents);

  document.querySelectorAll(".chip[data-throws]").forEach((chip) => {
    const n = Number(chip.dataset.throws);
    chip.querySelector("[data-price]").textContent = money(priceFor(n));
    // The 10-for-$7 bundle is the common sale, so it starts selected.
    chip.classList.toggle("on", n === settings.bundle_throws);
  });
  if (!editingEntryId) {
    el("throws").value = settings.bundle_throws;
    el("amount").value = dollars(settings.bundle_cents);
  }
}

async function loadPlayers() {
  const { data } = await db.from("leaderboard").select("*");
  players = (data || []).sort((a, b) => a.name.localeCompare(b.name));
  el("people").innerHTML = players.map((p) => `<option value="${escape(p.name)}"></option>`).join("");
  renderPlayers();
}

function renderPlayers() {
  const needle = el("player-search").value.trim().toLowerCase();
  const shown = needle ? players.filter((p) => p.name.toLowerCase().includes(needle)) : players;
  el("players-list").innerHTML = shown.length
    ? shown
        .map(
          (p) => `<div class="item">
            <div class="who">
              <strong>${escape(p.name)}</strong>
              <span>${num(p.points)} pts · ${money(p.amount_cents)} · ${p.rounds} round${p.rounds === 1 ? "" : "s"}</span>
            </div>
            <div class="acts">
              <button class="small ghost" data-rename="${p.id}">Rename</button>
              <button class="small danger" data-delete-player="${p.id}">Delete</button>
            </div>
          </div>`
        )
        .join("")
    : `<div class="empty">No players yet.</div>`;
}

async function loadEntries() {
  const { data } = await db
    .from("entries")
    .select("id, points, throws, amount_cents, created_at, participant_id, participants(name)")
    .order("created_at", { ascending: false })
    .limit(60);

  el("entries-list").innerHTML = (data || []).length
    ? data
        .map((entry) => {
          const when = new Date(entry.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          return `<div class="item">
            <div class="who">
              <strong>${escape(entry.participants?.name || "Unknown")}</strong>
              <span>${num(entry.points)} pts · ${entry.throws} throws · ${money(entry.amount_cents)} · ${when}</span>
            </div>
            <div class="acts">
              <button class="small ghost" data-edit="${entry.id}">Edit</button>
              <button class="small danger" data-delete-entry="${entry.id}">Delete</button>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="empty">Nothing entered yet.</div>`;
}

async function loadAll() {
  await loadSettings();
  await Promise.all([loadPlayers(), loadEntries()]);
}

/* ---------------- score entry ---------------- */

document.querySelectorAll(".chip[data-throws]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const n = Number(chip.dataset.throws);
    el("throws").value = n;
    el("amount").value = dollars(priceFor(n));
    document.querySelectorAll(".chip[data-throws]").forEach((c) => c.classList.toggle("on", c === chip));
    el("points").focus();
    el("points").select();
  });
});

// Typing a throw count re-prices it, but a hand-typed dollar amount is left alone.
el("throws").addEventListener("input", () => {
  el("amount").value = dollars(priceFor(Number(el("throws").value || 0)));
  document.querySelectorAll(".chip[data-throws]").forEach((c) => c.classList.remove("on"));
});

async function findOrCreateParticipant(name) {
  const match = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (match) return match.id;
  const { data, error } = await db.from("participants").insert({ name }).select("id").single();
  if (error) throw error;
  return data.id;
}

el("score-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("pname").value.trim();
  if (!name) return;

  const payload = {
    points: Math.max(0, Math.round(Number(el("points").value || 0))),
    throws: Math.max(0, Math.round(Number(el("throws").value || 0))),
    amount_cents: Math.max(0, toCents(el("amount").value)),
  };

  el("score-save").disabled = true;
  try {
    if (editingEntryId) {
      payload.participant_id = await findOrCreateParticipant(name);
      const { error } = await db.from("entries").update(payload).eq("id", editingEntryId);
      if (error) throw error;
      toast(`Updated ${name}`);
      cancelEdit();
    } else {
      payload.participant_id = await findOrCreateParticipant(name);
      const { error } = await db.from("entries").insert(payload);
      if (error) throw error;
      toast(`${name}: +${num(payload.points)} pts · ${money(payload.amount_cents)}`);
      el("score-form").reset();
      el("throws").value = settings.bundle_throws;
      el("amount").value = dollars(settings.bundle_cents);
      el("points").value = 0;
    }
    el("pname").focus();
    await Promise.all([loadPlayers(), loadEntries()]);
  } catch (error) {
    toast(error.message || "Could not save.", true);
  } finally {
    el("score-save").disabled = false;
  }
});

function cancelEdit() {
  editingEntryId = null;
  el("score-title").textContent = "Add a score";
  el("score-save").textContent = "Add to leaderboard";
  show(el("score-cancel"), false);
  el("score-form").reset();
  el("points").value = 0;
  if (settings) {
    el("throws").value = settings.bundle_throws;
    el("amount").value = dollars(settings.bundle_cents);
  }
}

el("score-cancel").addEventListener("click", cancelEdit);

/* ---------------- list actions ---------------- */

el("entries-list").addEventListener("click", async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.deleteEntry;

  if (editId) {
    const { data } = await db.from("entries").select("*, participants(name)").eq("id", editId).single();
    if (!data) return;
    editingEntryId = editId;
    el("pname").value = data.participants?.name || "";
    el("points").value = data.points;
    el("throws").value = data.throws;
    el("amount").value = dollars(data.amount_cents);
    el("score-title").textContent = "Edit this score";
    el("score-save").textContent = "Save changes";
    show(el("score-cancel"), true);
    switchTab("score");
    el("points").focus();
  }

  if (deleteId) {
    if (!confirm("Delete this score? It comes off that player's total.")) return;
    const { error } = await db.from("entries").delete().eq("id", deleteId);
    if (error) return toast(error.message, true);
    toast("Score deleted");
    await Promise.all([loadPlayers(), loadEntries()]);
  }
});

el("players-list").addEventListener("click", async (e) => {
  const renameId = e.target.dataset.rename;
  const deleteId = e.target.dataset.deletePlayer;

  if (renameId) {
    const player = players.find((p) => p.id === renameId);
    const name = prompt("New name:", player?.name || "");
    if (!name || !name.trim()) return;
    const { error } = await db.from("participants").update({ name: name.trim() }).eq("id", renameId);
    if (error) return toast(error.message, true);
    toast("Renamed");
    await Promise.all([loadPlayers(), loadEntries()]);
  }

  if (deleteId) {
    const player = players.find((p) => p.id === deleteId);
    if (!confirm(`Delete ${player?.name} and all of their scores? This can't be undone.`)) return;
    const { error } = await db.from("participants").delete().eq("id", deleteId);
    if (error) return toast(error.message, true);
    toast("Player deleted");
    await Promise.all([loadPlayers(), loadEntries()]);
  }
});

el("player-search").addEventListener("input", renderPlayers);

/* ---------------- settings ---------------- */

el("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db
    .from("event_settings")
    .update({
      event_name: el("s-name").value.trim(),
      tagline: el("s-tagline").value.trim(),
      goal_cents: toCents(el("s-goal").value),
      price_single_cents: toCents(el("s-single").value),
      bundle_throws: Math.max(1, Math.round(Number(el("s-bthrows").value || 10))),
      bundle_cents: toCents(el("s-bprice").value),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return toast(error.message, true);
  toast("Settings saved");
  await loadSettings();
});

el("reset-btn").addEventListener("click", async () => {
  if (prompt("This deletes every player and score. Type RESET to confirm.") !== "RESET") return;
  const { error } = await db.from("participants").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) return toast(error.message, true);
  toast("Board cleared");
  await Promise.all([loadPlayers(), loadEntries()]);
});

/* ---------------- tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) => show(p, p.dataset.panel === name));
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

await refreshAuth();
