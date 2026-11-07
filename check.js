// Comparing a query's result with the answer's. Shared by the page and the tests.
//
// Both queries run wrapped as SELECT COLUMNS(*)::VARCHAR FROM (…), so every
// value arrives as text. Then:
//   - numbers are compared to the cent (1.5, 1.50 and 1.4999999 all match),
//   - a midnight timestamp equals the date,
//   - column names don't matter, and columns can be in any order,
//   - row order matters only when the drill says so.

export function cleanSql(sql) {
  // Trailing semicolons and comments would break the wrapper.
  let s = String(sql).trim();
  while (s.endsWith(";")) s = s.slice(0, -1).trim();
  return s;
}

// Rough check for a second statement ("SELECT 1; SELECT 2"). Ignores
// semicolons inside quotes and comments.
export function hasManyStatements(sql) {
  const s = cleanSql(sql).replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return s.includes(";");
}

export function wrap(sql) {
  return `SELECT COLUMNS(*)::VARCHAR FROM (\n${cleanSql(sql)}\n) AS _result`;
}

export function norm(v) {
  if (v == null) return "∅";
  let s = String(v).trim();
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) {
    const n = Math.round(parseFloat(s) * 100) / 100;
    s = (Object.is(n, -0) ? 0 : n).toFixed(2);
    return s === "-0.00" ? "0.00" : s;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T]00:00:00(\.0+)?$/);
  return m ? m[1] : s;
}

const key = (row) => row.join("\u0001");

// Expected column j ← which user column? Match by identical sorted values, then
// prefer the same name, then the same position.
function matchColumns(user, exp) {
  const colVals = (res, i) => res.rows.map((r) => r[i]).sort().join("\u0002");
  const expSig = exp.cols.map((_, j) => colVals(exp, j));
  const userSig = user.cols.map((_, i) => colVals(user, i));
  const used = new Set(), map = [];
  for (let j = 0; j < exp.cols.length; j++) {
    const cands = user.cols.map((_, i) => i).filter((i) => !used.has(i) && userSig[i] === expSig[j]);
    const pick = cands.find((i) => user.cols[i].toLowerCase() === exp.cols[j].toLowerCase()) ?? (cands.includes(j) ? j : cands[0]);
    if (pick == null) return exp.cols.map((_, k) => k); // values differ somewhere: compare by position
    used.add(pick); map.push(pick);
  }
  return map;
}

// user / expected: { cols: [names], rows: [[values as text]] }
export function compare(user, expected, ordered = false) {
  const exp = { cols: expected.cols, rows: expected.rows.map((r) => r.map(norm)) };
  const usr = { cols: user.cols, rows: user.rows.map((r) => r.map(norm)) };
  const out = { ok: false, rows: usr.rows.length, expectedRows: exp.rows.length, extra: [], missing: [], cols: exp.cols };
  if (usr.cols.length !== exp.cols.length) {
    return { ...out, kind: "columns" };
  }
  const map = matchColumns(usr, exp);
  const userRows = usr.rows.map((r) => map.map((i) => r[i]));
  // Multiset difference in both directions. Compare normalized values, but
  // report the raw ones (103, not 103.00).
  const raw = (v) => (v == null ? null : String(v));
  const count = new Map();
  for (const r of exp.rows) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  userRows.forEach((r, n) => {
    const k = key(r), c = count.get(k) ?? 0;
    if (c > 0) count.set(k, c - 1); else out.extra.push(map.map((i) => raw(user.rows[n][i])));
  });
  const left = new Map(count);
  exp.rows.forEach((r, n) => {
    const k = key(r), c = left.get(k) ?? 0;
    if (c > 0) { out.missing.push(expected.rows[n].map(raw)); left.set(k, c - 1); }
  });
  if (out.extra.length || out.missing.length) {
    const kind = userRows.length > exp.rows.length ? "more" : userRows.length < exp.rows.length ? "fewer" : "values";
    return { ...out, kind, userCols: map.map((i) => usr.cols[i]) };
  }
  if (ordered && userRows.some((r, i) => key(r) !== key(exp.rows[i]))) return { ...out, kind: "order" };
  return { ...out, ok: true, kind: "ok" };
}
