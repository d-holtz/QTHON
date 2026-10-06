# QTHON x SigEp Football Toss — Live Leaderboard

A live, shareable leaderboard for the two-day football-toss fundraiser. Anyone with the
link can watch the board update in real time; only signed-in admins can add or edit scores.

- **`index.html`** — the public board. Share this link freely.
- **`admin.html`** — the scorer console. Requires a login that's on the admin list.

## How scoring works

Each time someone pays and throws, the scorer adds an **entry**: player name, points scored,
throws bought, dollars donated. A player's leaderboard row is the **sum of all their entries**,
so coming back to play again pushes them up the board. Dollars are calculated from the throws
bought ($1 each, 10 for $7 by default) and stay editable for tips and round-ups.

Ties are broken by who got to that score first.

## Five ways to enter data

All three write to the same live board — use whichever suits the moment.

1. **Upload Excel** (the main one). Drop an `.xlsx`, `.xlsm` or `.csv` into the console and the
   board updates immediately. The header row is found automatically even if it isn't row 1,
   columns are auto-mapped (and can be corrected by hand), and blank rows, note rows and a
   trailing `TOTAL` row are ignored. Numbers in the file are **totals**. Tick *Remove players who
   aren't in this file* to make the board match the spreadsheet exactly.
2. **Add score** (phone, at the table). Name, tap the $7 bundle, type points, save. Each save
   adds a round to that player's running total.
3. **Spreadsheet** (laptop). Every player is a row; click a cell, type, press Enter. These cells
   are **totals**, so typing 40 makes their score 40. `+ Add row` creates a player, and
   `Download CSV` exports the board for Excel.
4. **Paste from Excel** (bulk). Copy cells straight out of Excel or Google Sheets and paste them
   in, in the order `name, points, donated ($), throws`. A header row is ignored, `$` signs and
   commas are fine, and names that already exist are **updated rather than duplicated** — so you
   can keep a sheet open all day and re-paste it as often as you like without double-counting.

The two styles reconcile cleanly: the spreadsheet stores the difference as a single correction
row per player, so setting a total never destroys the round history behind it and never inflates
anyone's round count.

5. **Live Google Sheet** (hands-off, currently switched off). A scheduled job on the database reads your sheet once a
   minute and updates the board. Nothing has to stay open — not the console, not your laptop.
   Status, a *Sync now* button and an on/off switch live under the **Google Sheet** tab.

   The sheet is the source of truth for any name in it: the job reads columns
   `A=name, B=points, C=donated, D=throws`, skips the header and any row whose points cell isn't
   a number, and matches names case-insensitively. Deleting a row in the sheet does *not* delete
   that player from the board — do that in the console.

   Mechanically: `cron.schedule('sync-google-sheet', '* * * * *', ...)` → `public.sync_sheet()`
   → `http_get` the sheet's CSV export → `import_csv_text` → `import_players`. `sync_sheet()` is
   SECURITY DEFINER and only accepts `https://docs.google.com/` URLs so it can't be turned into a
   general-purpose fetcher. Admins can trigger it by hand via `sync_sheet_now()`.

There's also the **Supabase Table Editor** (supabase.com → your project → Table Editor), which is
a literal spreadsheet grid over the raw tables. It's the fallback if the site is ever unreachable.

## First-time setup

1. **Create the admin account.** Open `admin.html`, enter your email and a password, and hit
   *Create the admin account*. The first account created on the project automatically becomes
   the admin — everyone else who ever signs up gets read-only access.
2. **Check your event settings.** In the console, open *Event settings* and set the fundraising
   goal, pricing, and event name. These show up on the public board instantly.
3. **Share the board.** Send people the public URL (or put a QR code of it on the table).
   Nothing on the public page can edit anything.

### Adding another scorer

Two people entering scores during a rush is fine. Have them create an account on `admin.html`,
send you the user ID it shows them, then run this in the Supabase SQL editor:

```sql
insert into public.admins (user_id, email)
values ('<their-user-id>', '<their-email>');
```

Remove them the same way with `delete from public.admins where user_id = '<their-user-id>';`

## Deploying

The site is plain static HTML/CSS/JS — no build step.

**Vercel:** import this repo at [vercel.com/new](https://vercel.com/new), leave the framework as
*Other*, and deploy. Every push to the branch redeploys automatically.

**Anywhere else:** upload the files as-is, or run `python3 -m http.server 8000` locally and open
`http://localhost:8000`.

## Database

Supabase project `qthon-football-toss`.

| Table | What's in it |
| --- | --- |
| `participants` | One row per player (id, name) |
| `entries` | One row per scored round (points, throws, amount, timestamp) |
| `event_settings` | Event name, tagline, goal, pricing |
| `admins` | Which accounts may write |
| `leaderboard` (view) | Players with their summed points, dollars, throws, and rounds |

Row-level security is on for every table: anyone may read the board, only rows in `admins`
may write. The key in `assets/config.js` is the publishable key and is safe to ship in the
browser — it can't bypass those rules.

### Exporting results

After the event, in the Supabase SQL editor:

```sql
select name, points, amount_cents / 100.0 as donated, throws, rounds
from public.leaderboard
order by points desc;
```

### Updating the Supabase client

`assets/vendor/supabase.js` is a bundled copy of `@supabase/supabase-js` (v2.116.0) so the
board loads nothing from a third-party CDN during the event. To refresh it:

```sh
npm i @supabase/supabase-js esbuild
echo 'export { createClient } from "@supabase/supabase-js";' > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 \
  --outfile=assets/vendor/supabase.js
```
