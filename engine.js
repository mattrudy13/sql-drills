// DuckDB in the browser. It's a ~7 MB download, so it loads on the first Run,
// Check or Preview, not with the page; the browser caches it after that.
// The version is pinned to the one the tests run (package.json).
import { SETUP_SQL } from "./data.js";
import { wrap, hasManyStatements } from "./check.js";

const VERSION = "1.33.1-dev57.0";
let ready = null;

function load() {
  ready ??= (async () => {
    const duckdb = await import(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${VERSION}/+esm`);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    // Browsers won't start a worker straight from another site, so start a
    // tiny same-origin one that imports DuckDB's worker script.
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    return db.connect();
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export const isLoaded = () => ready != null;

const toResult = (table) => {
  const cols = table.schema.fields.map((f) => f.name);
  return { cols, rows: table.toArray().map((row) => { const o = row.toJSON(); return cols.map((c) => (o[c] == null ? null : String(o[c]))); }) };
};

// Runs one query against a fresh copy of the practice tables, so a DELETE or
// DROP in an earlier run can't break the next drill.
export async function runQuery(sql) {
  if (!sql.trim()) throw new Error("The editor is empty.");
  if (hasManyStatements(sql)) throw new Error("Run one query at a time (there's a ; in the middle).");
  const conn = await load();
  await conn.query(SETUP_SQL);
  try {
    return toResult(await conn.query(wrap(sql)));
  } catch (e) {
    // EXPLAIN, DESCRIBE, SHOW and friends can't sit inside the wrapper; run them as written.
    if (/^\s*(explain|describe|show|summarize|pragma)\b/i.test(sql)) return toResult(await conn.query(sql));
    throw e;
  }
}
