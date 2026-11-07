// Run: npm test
// Every answer runs on the same DuckDB-WASM build the page loads, every
// "wrong" query must fail the check (so each trap really bites), and the
// checker's own rules are tested on small cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SETUP_SQL, TABLES } from "../data.js";
import { DRILLS, TOPICS } from "../drills.js";
import { wrap, compare, norm, hasManyStatements } from "../check.js";

const require = createRequire(import.meta.url);
const { open } = require("./duck.cjs");
const conn = await open();
conn.query(SETUP_SQL);

function run(sql) {
  const r = conn.query(wrap(sql));
  const cols = r.schema.fields.map((f) => f.name);
  return { cols, rows: r.toArray().map((row) => { const o = row.toJSON(); return cols.map((c) => o[c]); }) };
}

test("drill ids are unique and every drill has its parts", () => {
  assert.equal(new Set(DRILLS.map((d) => d.id)).size, DRILLS.length);
  for (const t of TOPICS) assert.equal(DRILLS.filter((d) => d.topic === t.id).length, 5, t.id);
  for (const d of DRILLS) {
    assert.ok(d.title && d.task && d.why && d.hint, d.id);
    if (d.type === "choice") assert.ok(d.options[d.correct], d.id);
    else assert.ok(d.answer && d.wrong?.length && d.tables.every((t) => TABLES.some((x) => x.name === t)), d.id);
  }
});

for (const d of DRILLS.filter((x) => x.type !== "choice")) {
  test(`${d.id} ${d.title}: answer runs, wrong answers fail`, () => {
    const exp = run(d.answer);
    assert.ok(exp.rows.length > 0, "answer returns rows");
    assert.ok(compare(exp, exp, d.ordered).ok, "answer matches itself");
    for (const w of d.wrong) {
      const res = compare(run(w), exp, d.ordered);
      assert.equal(res.ok, false, `this wrong answer passed: ${w}`);
      assert.ok(d.traps[res.kind] || res.kind === "columns", `${d.id}: no trap text for "${res.kind}" (${w.slice(0, 60)}…)`);
    }
  });
}

test("checker: numbers to the cent, dates, column order, row order", () => {
  assert.equal(norm("1.5"), "1.50");
  assert.equal(norm("1.4999999"), "1.50");
  assert.equal(norm("-0.001"), "0.00");
  assert.equal(norm("2026-03-01 00:00:00"), "2026-03-01");
  assert.equal(norm(null), "∅");
  const exp = { cols: ["a", "b"], rows: [["1", "x"], ["2", "y"]] };
  assert.ok(compare({ cols: ["b2", "a2"], rows: [["y", "2"], ["x", "1"]] }, exp).ok);
  assert.equal(compare({ cols: ["a", "b"], rows: [["2", "y"], ["1", "x"]] }, exp, true).kind, "order");
  const more = compare({ cols: ["a", "b"], rows: [["1", "x"], ["2", "y"], ["3", "z"]] }, exp);
  assert.equal(more.kind, "more");
  assert.deepEqual(more.extra, [["3", "z"]]);
  assert.equal(compare({ cols: ["a"], rows: [["1"]] }, exp).kind, "columns");
  assert.equal(hasManyStatements("SELECT ';' AS x;"), false);
  assert.equal(hasManyStatements("DROP TABLE x; SELECT 1"), true);
});
