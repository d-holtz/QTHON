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
  renderSheet();
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
  await Promise.all([loadPlayers(), loadEntries(), loadSync()]);
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


/* ---------------- spreadsheet ---------------- */

const sheetBody = () => el("sheet-body");

function sheetRow(p) {
  return `<tr data-id="${p?.id || ""}">
    <td><input class="cell" data-field="name" value="${escape(p?.name || "")}" placeholder="New player" autocomplete="off"></td>
    <td><input class="cell num" data-field="points" type="number" step="1" inputmode="numeric" value="${p?.points ?? 0}"></td>
    <td><input class="cell num" data-field="amount" type="number" step="0.01" inputmode="decimal" value="${dollars(p?.amount_cents || 0)}"></td>
    <td><input class="cell num" data-field="throws" type="number" step="1" inputmode="numeric" value="${p?.throws ?? 0}"></td>
    <td class="act"><button type="button" data-remove title="Delete this player">&times;</button></td>
  </tr>`;
}

// Never redraw under someone's cursor — a rebuild mid-keystroke would eat what they typed.
function renderSheet(force = false) {
  const body = sheetBody();
  if (!body) return;
  if (!force && body.contains(document.activeElement)) return;
  body.innerHTML = players.map(sheetRow).join("");
}

function sheetStatus(text, isError = false) {
  const node = el("sheet-status");
  node.textContent = text;
  node.style.color = isError ? "var(--red)" : "var(--muted)";
}

function readRow(tr) {
  const get = (field) => tr.querySelector(`[data-field="${field}"]`);
  return {
    name: get("name").value.trim(),
    points: Math.round(Number(get("points").value || 0)),
    amount_cents: toCents(get("amount").value),
    throws: Math.round(Number(get("throws").value || 0)),
  };
}

async function saveRow(tr) {
  const row = readRow(tr);
  if (!row.name) return;

  tr.classList.add("saving");
  sheetStatus("Saving…");
  try {
    let id = tr.dataset.id;
    if (!id) {
      id = await findOrCreateParticipant(row.name);
      tr.dataset.id = id;
    } else {
      const known = players.find((p) => p.id === id);
      if (known && known.name !== row.name) {
        const { error } = await db.from("participants").update({ name: row.name }).eq("id", id);
        if (error) throw error;
      }
    }

    const { error } = await db.rpc("set_player_totals", {
      p_participant: id,
      p_points: row.points,
      p_amount_cents: row.amount_cents,
      p_throws: row.throws,
    });
    if (error) throw error;

    tr.classList.add("saved");
    setTimeout(() => tr.classList.remove("saved"), 900);
    sheetStatus(`Saved ${row.name}`);
    await Promise.all([loadPlayers(), loadEntries()]);
  } catch (error) {
    sheetStatus(error.message || "Could not save", true);
    toast(error.message || "Could not save", true);
  } finally {
    tr.classList.remove("saving");
  }
}

sheetBody().addEventListener("change", (e) => {
  const tr = e.target.closest("tr");
  if (tr && e.target.classList.contains("cell")) saveRow(tr);
});

// Enter commits and drops into the same column on the next row, like a spreadsheet.
sheetBody().addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const tr = e.target.closest("tr");
  const field = e.target.dataset.field;
  e.target.blur();
  const next = tr.nextElementSibling?.querySelector(`[data-field="${field}"]`);
  if (next) { next.focus(); next.select(); }
});

sheetBody().addEventListener("click", async (e) => {
  if (!("remove" in e.target.dataset)) return;
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  if (!id) return tr.remove();
  const player = players.find((p) => p.id === id);
  if (!confirm(`Delete ${player?.name} and all of their scores?`)) return;
  const { error } = await db.from("participants").delete().eq("id", id);
  if (error) return toast(error.message, true);
  await Promise.all([loadPlayers(), loadEntries()]);
  sheetStatus("Player deleted");
});

el("sheet-add").addEventListener("click", () => {
  sheetBody().insertAdjacentHTML("beforeend", sheetRow(null));
  const input = sheetBody().lastElementChild.querySelector('[data-field="name"]');
  input.focus();
  input.scrollIntoView({ block: "center", behavior: "smooth" });
});

/* ---------------- paste from Excel / Sheets ---------------- */

const toggle = (node) => node.classList.toggle("hidden");
el("sheet-paste-toggle").addEventListener("click", () => toggle(el("paste-box")));
el("paste-cancel").addEventListener("click", () => {
  el("paste-area").value = "";
  el("paste-box").classList.add("hidden");
});

// Strips $, thousands separators and stray quotes so pasted spreadsheet cells parse.
const parseNumber = (cell) => {
  const n = Number(String(cell || "").replace(/[$,"\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

export function parsePastedRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.includes("\t") ? line.split("\t") : line.split(",")))
    .map((cells) => ({
      name: String(cells[0] || "").replace(/^"|"$/g, "").trim(),
      points: parseNumber(cells[1]),
      amount: parseNumber(cells[2]),
      throws: parseNumber(cells[3]),
    }))
    // Drops a header row, since its points cell never parses as a number.
    .filter((row) => row.name && !Number.isNaN(row.points))
    .map((row) => ({
      name: row.name,
      points: Math.round(row.points),
      amount_cents: Number.isNaN(row.amount) ? 0 : Math.round(row.amount * 100),
      throws: Number.isNaN(row.throws) ? 0 : Math.round(row.throws),
    }));
}

el("paste-import").addEventListener("click", async () => {
  const rows = parsePastedRows(el("paste-area").value);
  if (!rows.length) return toast("Nothing to import — each row needs a name and a points number.", true);
  if (!confirm(`Import ${rows.length} row${rows.length === 1 ? "" : "s"}? Existing players are updated to match.`)) return;

  const { data, error } = await db.rpc("import_players", { rows });
  if (error) return toast(error.message, true);
  toast(`Imported ${data} row${data === 1 ? "" : "s"}`);
  el("paste-area").value = "";
  el("paste-box").classList.add("hidden");
  await Promise.all([loadPlayers(), loadEntries()]);
  renderSheet(true);
});

el("sheet-export").addEventListener("click", () => {
  const header = ["Name", "Points", "Donated", "Throws", "Rounds"];
  const body = [...players]
    .sort((a, b) => b.points - a.points)
    .map((p) => [`"${p.name.replace(/"/g, '""')}"`, p.points, dollars(p.amount_cents), p.throws, p.rounds]);
  const csv = [header, ...body].map((r) => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `qthon-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});


/* ---------------- google sheet sync ---------------- */

let syncConfig = null;

function timeAgo(iso) {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso)) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

function renderSync() {
  if (!syncConfig) return;
  const dot = el("sync-dot");
  const headline = el("sync-headline");
  const detail = el("sync-detail");

  dot.className = "sync-dot";
  el("sync-url").value = syncConfig.csv_url || "";
  el("sync-toggle").textContent = syncConfig.enabled ? "Turn off" : "Turn on";

  if (!syncConfig.enabled) {
    dot.classList.add("off");
    headline.textContent = "Sheet sync is off";
    detail.textContent = "The board only changes when you enter scores here.";
    return;
  }

  if (syncConfig.last_status === "ok") {
    dot.classList.add("ok");
    headline.textContent = `Synced ${timeAgo(syncConfig.last_run_at)}`;
    detail.textContent = `${syncConfig.last_row_count} player row${syncConfig.last_row_count === 1 ? "" : "s"} read from the sheet · checks again every minute`;
  } else if (syncConfig.last_status === "error") {
    dot.classList.add("err");
    headline.textContent = "Sync problem";
    detail.textContent = syncConfig.last_error || "Unknown error";
  } else {
    headline.textContent = "Waiting for the first sync";
    detail.textContent = "This happens within a minute. Press Sync now to do it immediately.";
  }
}

async function loadSync() {
  const { data, error } = await db.from("sheet_sync").select("*").single();
  if (error) return;
  syncConfig = data;
  renderSync();
}

el("sync-now").addEventListener("click", async () => {
  el("sync-now").disabled = true;
  el("sync-headline").textContent = "Syncing…";
  const { data, error } = await db.rpc("sync_sheet_now");
  el("sync-now").disabled = false;
  if (error) return toast(error.message, true);
  if (data?.status === "ok") toast(`Sheet read: ${data.rows} row${data.rows === 1 ? "" : "s"}`);
  else if (data?.status === "disabled") toast("Sheet sync is turned off.", true);
  else toast(data?.error || "Sync failed", true);
  await Promise.all([loadSync(), loadPlayers(), loadEntries()]);
});

el("sync-toggle").addEventListener("click", async () => {
  const { error } = await db.from("sheet_sync").update({ enabled: !syncConfig.enabled }).eq("id", true);
  if (error) return toast(error.message, true);
  await loadSync();
  toast(syncConfig.enabled ? "Sheet sync on" : "Sheet sync off");
});

el("sync-save").addEventListener("click", async () => {
  const { error } = await db.from("sheet_sync").update({ csv_url: el("sync-url").value.trim() }).eq("id", true);
  if (error) return toast(error.message, true);
  await loadSync();
  toast("Sheet link saved");
});

// Keep the "synced 20s ago" line honest while the tab sits open.
setInterval(() => {
  if (!document.querySelector('[data-panel="gsheet"]')?.classList.contains("hidden")) loadSync();
}, 20000);


/* ---------------- excel upload ---------------- */

let sheetRows = [];      // raw rows from the file, as arrays
let headerIndex = -1;    // which row held the headers, -1 if none
let xlsxLib = null;

// 330KB parser, only fetched the first time someone actually uploads something.
async function loadXlsx() {
  if (!xlsxLib) xlsxLib = await import("./vendor/xlsx.js");
  return xlsxLib;
}

const COLUMN_LETTERS = (i) => {
  let label = "";
  let n = i;
  do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return label;
};

// Looks for the row that names the columns, so totals rows and title rows above it don't matter.
function findHeaderRow(rows) {
  const looksLikeName = /^\s*(name|player|participant|person|full\s*name)\s*$/i;
  const looksLikeNumber = /(point|score|donat|amount|paid|raised|\$|throw)/i;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map((c) => String(c ?? "").trim());
    if (cells.some((c) => looksLikeName.test(c)) && cells.some((c) => looksLikeNumber.test(c))) return i;
  }
  return -1;
}

function guessColumn(headers, patterns, fallback) {
  for (const pattern of patterns) {
    const found = headers.findIndex((h) => pattern.test(h));
    if (found !== -1) return found;
  }
  return fallback;
}

function columnOptions(headers) {
  return headers
    .map((h, i) => `<option value="${i}">${escape(h ? `${COLUMN_LETTERS(i)} — ${h}` : `Column ${COLUMN_LETTERS(i)}`)}</option>`)
    .join("");
}

function dataRows() {
  return sheetRows.slice(headerIndex + 1);
}

// Pull the numbers out of whatever the file holds: "$7.00", "7", 7, " 7 " all work.
function cellNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "") return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function buildRows() {
  const pick = (id) => Number(el(id).value);
  const [nameCol, pointsCol, amountCol, throwsCol] = ["col-name", "col-points", "col-amount", "col-throws"].map(pick);

  return dataRows()
    .map((row) => {
      const name = String(row[nameCol] ?? "").trim();
      const points = cellNumber(row[pointsCol]);
      const amount = amountCol === -1 ? NaN : cellNumber(row[amountCol]);
      const throwCount = throwsCol === -1 ? NaN : cellNumber(row[throwsCol]);
      return { name, points, amount, throwCount };
    })
    // A row counts only if it names someone and gives a number; that drops blank rows,
    // notes and any "TOTAL" line at the bottom.
    .filter((r) => r.name && !Number.isNaN(r.points) && !/^(total|totals|sum|grand total)$/i.test(r.name))
    .map((r) => ({
      name: r.name,
      points: Math.round(r.points),
      amount_cents: Number.isNaN(r.amount) ? 0 : Math.round(r.amount * 100),
      throws: Number.isNaN(r.throwCount) ? 0 : Math.round(r.throwCount),
    }));
}

function renderPreview() {
  const rows = buildRows();
  const shown = rows.slice(0, 6);
  el("preview-table").innerHTML = shown.length
    ? `<tr><td>Name</td><td class="num">Points</td><td class="num">Donated</td><td class="num">Throws</td></tr>` +
      shown.map((r) => `<tr>
        <td>${escape(r.name)}</td>
        <td class="num">${num(r.points)}</td>
        <td class="num">${money(r.amount_cents)}</td>
        <td class="num">${num(r.throws)}</td>
      </tr>`).join("")
    : `<tr><td style="color:var(--red)">No usable rows found — check the column choices above.</td></tr>`;

  el("preview-note").textContent = rows.length
    ? `${rows.length} player${rows.length === 1 ? "" : "s"} ready${rows.length > 6 ? ` (showing the first 6)` : ""}.`
    : "";
  el("do-import").disabled = rows.length === 0;
}

async function handleFile(file) {
  if (!file) return;
  try {
    const { read, utils } = await loadXlsx();
    const buffer = await file.arrayBuffer();
    const book = read(buffer, { type: "array" });
    const firstSheet = book.Sheets[book.SheetNames[0]];
    sheetRows = utils.sheet_to_json(firstSheet, { header: 1, blankrows: false, raw: true });
  } catch (error) {
    return toast("Could not read that file — is it a real .xlsx or .csv?", true);
  }

  if (!sheetRows.length) return toast("That file looks empty.", true);

  headerIndex = findHeaderRow(sheetRows);
  const width = Math.max(...sheetRows.map((r) => r.length), 1);
  const headers = headerIndex === -1
    ? Array.from({ length: width }, () => "")
    : Array.from({ length: width }, (_, i) => String(sheetRows[headerIndex][i] ?? "").trim());

  const options = columnOptions(headers);
  el("col-name").innerHTML = options;
  el("col-points").innerHTML = options;
  el("col-amount").innerHTML = `<option value="-1">— none —</option>` + options;
  el("col-throws").innerHTML = `<option value="-1">— none —</option>` + options;

  el("col-name").value = guessColumn(headers, [/^\s*(name|player|participant|person)/i], 0);
  el("col-points").value = guessColumn(headers, [/point/i, /score/i], 1);
  el("col-amount").value = guessColumn(headers, [/donat/i, /amount/i, /paid/i, /raised/i, /\$/], 2);
  el("col-throws").value = guessColumn(headers, [/throw/i], -1);

  el("file-name").textContent = file.name;
  el("file-meta").textContent = `${dataRows().length} rows${headerIndex === -1 ? " · no header row found, check the columns" : ""}`;
  el("dropzone").classList.add("hidden");
  el("map-box").classList.remove("hidden");
  el("import-status").textContent = "";
  renderPreview();
}

const dropzone = el("dropzone");
const fileInput = el("file-input");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add("over"); }));
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.remove("over"); }));
dropzone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

["col-name", "col-points", "col-amount", "col-throws"].forEach((id) =>
  el(id).addEventListener("change", renderPreview));

el("file-clear").addEventListener("click", () => {
  sheetRows = [];
  fileInput.value = "";
  el("map-box").classList.add("hidden");
  el("dropzone").classList.remove("hidden");
});

el("do-import").addEventListener("click", async () => {
  const rows = buildRows();
  if (!rows.length) return;
  const prune = el("prune").checked;

  const warning = prune
    ? `Update ${rows.length} player${rows.length === 1 ? "" : "s"} and REMOVE anyone not in this file?`
    : `Update the board with ${rows.length} player${rows.length === 1 ? "" : "s"}?`;
  if (!confirm(warning)) return;

  el("do-import").disabled = true;
  el("import-status").textContent = "Uploading…";
  try {
    const { data: imported, error } = await db.rpc("import_players", { rows });
    if (error) throw error;

    let removed = 0;
    if (prune) {
      const { data, error: pruneError } = await db.rpc("remove_missing_players", { keep_names: rows.map((r) => r.name) });
      if (pruneError) throw pruneError;
      removed = data || 0;
    }

    el("import-status").textContent = `Done — ${imported} updated${removed ? `, ${removed} removed` : ""}.`;
    toast(`Leaderboard updated: ${imported} player${imported === 1 ? "" : "s"}`);
    await Promise.all([loadPlayers(), loadEntries()]);
  } catch (error) {
    el("import-status").textContent = "";
    toast(error.message || "Upload failed", true);
  } finally {
    el("do-import").disabled = false;
  }
});

/* ---------------- tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) => show(p, p.dataset.panel === name));
  if (name === "sheet") renderSheet(true);
  if (name === "gsheet") loadSync();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

await refreshAuth();
