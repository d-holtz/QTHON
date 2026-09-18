// Vendored @supabase/supabase-js (see README) so the board has no CDN dependency on event day.
import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } },
});

export const money = (cents) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });

export const num = (n) => Number(n || 0).toLocaleString("en-US");

// Ranks a sorted list, letting equal point totals share a rank.
export function withRanks(rows) {
  let lastPoints = null;
  let lastRank = 0;
  return rows.map((row, i) => {
    const rank = row.points === lastPoints ? lastRank : i + 1;
    lastPoints = row.points;
    lastRank = rank;
    return { ...row, rank };
  });
}

// Points first; on a tie whoever got there first stays ahead.
export function sortBoard(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const at = a.last_scored_at || a.created_at;
    const bt = b.last_scored_at || b.created_at;
    return new Date(at) - new Date(bt);
  });
}
