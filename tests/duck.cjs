// Loads the same DuckDB-WASM build the page uses, but in Node, for the tests.
const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
const path = require("path");
const DIST = path.join(path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs")), "/");

async function open() {
  const bundles = {
    mvp: { mainModule: DIST + "duckdb-mvp.wasm", mainWorker: DIST + "duckdb-node-mvp.worker.cjs" },
    eh: { mainModule: DIST + "duckdb-eh.wasm", mainWorker: DIST + "duckdb-node-eh.worker.cjs" },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  return db.connect();
}
module.exports = { open };
