# QTHON Football Toss — Live Rankings

A single page that reads a Google Sheet and shows it as a ranked leaderboard. No database,
no login, no uploading: you type in the sheet, the page follows within 30 seconds.

**`index.html`** is the whole thing — one self-contained file with no dependencies.

## Setup

1. In your Google Sheet: **Share → General access → Anyone with the link → Viewer.**
   (Viewer is enough. The page only reads it; you stay the only person who can edit.)
2. Open the deployed page. Paste your sheet's link into the setup box.
3. The address becomes `…/?sheet=<SHEET_ID>` — **that's your shareable link.**

## What the sheet needs

A column of names and a column of points. A donation column is used if there is one.

| Name | Points | Donation |
| --- | --- | --- |
| Jordan Reyes | 35 | 7 |

Headings are matched loosely — `Player`/`Name`, `Points`/`Score`, `Donation`/`Raised`/`Amount`/`Paid`
all work, in any column order. The page tries the column labels and then each of the first ten
rows as a header row, scoring each guess by how many usable players it yields (with a tiebreak
favouring guesses whose headings actually matched), so a title row above the headings is fine.

Ignored automatically: blank rows, rows whose points cell isn't a number, and a trailing
`TOTAL` row. Money parses from `7`, `$7`, `$1,200.50`.

Equal scores share a rank.

## Options

| URL | Effect |
| --- | --- |
| `?sheet=<ID>` | Which sheet to read (also accepts a full Google URL) |
| `&tab=<name>` | A tab other than the first |
| `&tv` | TV mode — big text for a screen at the table (also a button on the page) |

## How it reads the sheet

Google's `gviz` endpoint, loaded through a `<script>` tag rather than `fetch()`. That sidesteps
browser cross-origin rules completely — no proxy, no server, no API key. If the sheet isn't
shared, the page says so in plain language instead of sitting blank.

## Deploying

Static hosting, no build step. This repo is connected to Vercel and redeploys on every push to
`claude/qthon-fundraiser-leaderboard-558fjr`.

## Older approach

`admin.html`, `legacy-board.html` and `assets/` are a previous version backed by a Supabase
database with logins, file uploads and a scheduled sheet import. Nothing in the current page
touches any of it; it's kept only in case it's wanted later. The current page needs none of it.
