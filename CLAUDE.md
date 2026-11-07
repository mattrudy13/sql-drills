# Query Workbook (sql-drills): project notes

SQL practice for Rudy on a made-up bank database: window functions, joins and duplicates, aggregation and NULL
traps, and Spark query cost. Queries run in the browser on DuckDB-WASM. Live at
https://mattrudy13.github.io/sql-drills/ (repo `mattrudy13/sql-drills`, public, GitHub Pages from `main` at the
root). Mockups ("Workbook" look, A, was picked): https://claude.ai/artifact/HmLcoaU7rT4YQv2e9kigtu. Ideas for
later: `ENHANCEMENTS.md`.

## Versions

- **v0.1** (2026-11-07): 20 drills (5 per topic), editor with highlighting, Run/Check with a row diff, hints,
  Show answer, "why it works" notes, phone Task/Query/Result tabs with a SQL key row.

## Rudy's choices (ask before changing)

- **Audience:** Rudy first; maybe a portfolio card later once polished. Not linked from the Board yet.
- **Engine: DuckDB-WASM**, not SQLite (picked 2026-11-07): its SQL matches Databricks habits (QUALIFY,
  date_trunc, FILTER, GROUP BY ALL) and EXPLAIN shows real plans. ~7 MB brotli from jsDelivr, loaded on the first
  Run/Check/Preview and cached by the browser. Pinned to `1.33.1-dev57.0` (DuckDB v1.5.4) in both `engine.js` and
  `package.json`; bump them together.
- **Wrong answers show the diff** (picked 2026-11-07): a row-count line, up to 3 extra and 3 missing rows (cells that
  differ are highlighted when rows pair up), and the drill's trap note. The answer query shows only on "Show answer".
- **Data is invented bank data** (customers, accounts, transactions, SCD2 history, a staging table). Nothing from
  Rudy's job.
- Query-cost drills are multiple choice with the plan shown, because a browser can't show what a cluster does.
- Workbook look: Source Serif 4 for reading, JetBrains Mono for SQL, Inter for UI, indigo actions, dark editor.

## How checking works (`check.js`)

- Both the user's query and the answer run wrapped as `SELECT COLUMNS(*)::VARCHAR FROM (…)`, so values arrive as
  text with the column names kept.
- Numbers compare to the cent; a midnight timestamp equals its date; column names don't matter and columns may be
  in any order (matched by identical value sets); row order matters only when a drill has `ordered: true`.
- Kinds: `columns`, `more`, `fewer`, `values`, `order`, `ok`. Each drill's `traps` has text per kind.
- Every Run re-creates the tables first (`SETUP_SQL` is CREATE OR REPLACE), so a DELETE or DROP can't break later
  drills. One statement at a time; EXPLAIN/DESCRIBE/SHOW run unwrapped.

## Adding a drill

1. Add it to `DRILLS` in `drills.js` (5 per topic is what the tests expect today; change the test if a topic grows).
2. If it needs a trap the data doesn't have, plant rows in `data.js` with a comment naming the drill.
3. Give it `wrong`: the common mistakes. `npm test` runs the answer and proves every wrong query fails the check and
   has trap text for the way it fails. Don't ship a drill whose wrong answers pass.

## Files

- `index.html`, `style.css`, `app.js`: the page. Plain JS modules, no build. Drill in the hash (`#w1`).
  Progress in localStorage `sqldrills:v1` (solved, revealed, saved queries, last drill). The origin is shared with
  Rudy's other Pages sites, so keep the key prefix.
- `engine.js`: loads DuckDB from jsDelivr (`+esm`), starts its worker through a same-origin blob, runs queries.
- `data.js`: the tables, seeded and partly hand-planted, written out as `SETUP_SQL`.
- `drills.js`: topics and drills. `check.js`: result comparison.
- `tests/`: `npm test` (installs nothing at runtime; `npm install` once for the DuckDB-WASM dev dependency, ~160 MB
  in node_modules, ignored by git). `tests/duck.cjs` opens the Node build of the same DuckDB-WASM.
- `favicon.svg`, `apple-touch-icon.png` (rendered from the SVG with headless Chrome).

## Checking a change

`npm test`, then open the page, Check a wrong and a right answer on a drill (first Check downloads DuckDB), try a
choice drill, and look at 1280px and 360px (Task/Query/Result tabs, no sideways scroll). Previewing from the
GitHub folder root on port 8765 can serve another site's cached `style.css`/`app.js`: reload them with
`fetch(url, {cache: "reload"})` first.
