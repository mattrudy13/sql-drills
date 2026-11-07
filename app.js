// The page: drill navigation, the editor, Run/Check and the feedback.
import { TOPICS, DRILLS } from "./drills.js";
import { TABLES } from "./data.js";
import { compare } from "./check.js";
import { runQuery, isLoaded } from "./engine.js";

const STORE = "sqldrills:v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = Object.fromEntries(DRILLS.map((d) => [d.id, d]));

// ---------------------------------------------------------------- progress

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE));
    if (p && p.version === 1) return p;
  } catch { /* private mode: start fresh */ }
  return { version: 1, solved: {}, revealed: {}, queries: {}, last: null };
}
let progress = loadProgress();
function save() { try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch { /* not saved; fine */ } }

const ui = { id: null, pane: "task", hint: false, result: null, feedback: null, busy: false, choice: null };

// ---------------------------------------------------------------- SQL highlighting

const KEYWORDS = new Set(`select from where group by order having qualify with as join left right full inner outer cross anti semi on using and or not in is null case when then else end distinct union all except intersect limit offset over partition rows range between preceding following current row unbounded asc desc exists cast interval date timestamp true false filter window like ilike nulls first last lateral values explain describe recursive insert into update delete set create table replace drop`.split(" "));

function highlight(sql) {
  const re = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(?=(\s*\())?|([\s\S])/g;
  let out = "", m;
  while ((m = re.exec(sql))) {
    if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-n">${m[3]}</span>`;
    else if (m[4]) {
      const w = m[4].toLowerCase();
      out += KEYWORDS.has(w) ? `<span class="tk-k">${esc(m[4])}</span>` : m[5] ? `<span class="tk-f">${esc(m[4])}</span>` : esc(m[4]);
    } else out += esc(m[6]);
  }
  return out + "\n "; // a trailing newline needs a character after it to take up space
}

// ---------------------------------------------------------------- render: sidebar

function renderSide() {
  const d = byId[ui.id];
  $("#topics").innerHTML = TOPICS.map((t) => {
    const list = DRILLS.filter((x) => x.topic === t.id);
    const done = list.filter((x) => progress.solved[x.id]).length;
    const open = t.id === d.topic;
    return `<div class="topic${open ? " open" : ""}">
      <a class="topic-link" href="#${firstOpen(t.id)}" ${open ? 'aria-current="true"' : ""}><span>${esc(t.name)}</span><span class="count">${done} / ${list.length}</span></a>
      ${open ? `<ol class="drill-list">${list.map((x, i) => `<li><a href="#${x.id}" class="${progress.solved[x.id] ? "solved" : ""}" ${x.id === d.id ? 'aria-current="page"' : ""}>
        <span class="mark">${progress.solved[x.id] ? "✓" : x.id === d.id ? "→" : ""}</span>${i + 1}. ${esc(x.title)}</a></li>`).join("")}</ol>` : ""}
    </div>`;
  }).join("");
  const idx = DRILLS.filter((x) => x.topic === d.topic).indexOf(d) + 1;
  $("#phone-where").textContent = `${TOPICS.find((t) => t.id === d.topic).name} · ${idx} of 5`;
}

const firstOpen = (topic) => (DRILLS.find((x) => x.topic === topic && !progress.solved[x.id]) ?? DRILLS.find((x) => x.topic === topic)).id;

// ---------------------------------------------------------------- render: drill

function renderDrill() {
  const d = byId[ui.id];
  const list = DRILLS.filter((x) => x.topic === d.topic);
  const idx = list.indexOf(d) + 1;
  const isChoice = d.type === "choice";
  const unlocked = progress.solved[d.id] || progress.revealed[d.id];
  $("#main").innerHTML = `<div class="drill${isChoice ? " choice" : ""}">
    <section class="pane pane-task" data-pane="task">
      <div class="meta">${esc(TOPICS.find((t) => t.id === d.topic).name)} · Drill ${idx} of ${list.length}${progress.solved[d.id] ? ` · <span class="ok-text">solved</span>` : ""}</div>
      <h1>${esc(d.title)}</h1>
      <div class="task">${d.task}</div>
      ${isChoice ? d.plans.map((p) => `<figure class="plan"><figcaption>${esc(p.label)}</figcaption><pre>${esc(p.text)}</pre></figure>`).join("") : tablesBlock(d)}
      <div class="hint-row">
        <button class="link" data-action="hint" aria-expanded="${ui.hint}">${ui.hint ? "Hide hint" : "Hint"}</button>
        ${!isChoice && !progress.solved[d.id] ? `<button class="link" data-action="reveal">Show answer</button>` : ""}
      </div>
      ${ui.hint ? `<p class="hint">${d.hint}</p>` : ""}
      ${!isChoice && progress.revealed[d.id] ? `<div class="answer"><div class="answer-head"><span>Answer</span><button class="link" data-action="use-answer">Put it in the editor</button></div><pre>${highlight(d.answer)}</pre></div>` : ""}
      <div class="why${unlocked ? "" : " locked"}">
        <h2>Why it works</h2>
        ${unlocked ? d.why : `<p>Shows up once you solve it${isChoice ? "" : " or show the answer"}.</p>`}
      </div>
    </section>
    <section class="pane pane-query" data-pane="query">${isChoice ? choiceBlock(d) : editorBlock(d)}</section>
    <section class="pane pane-result" data-pane="result" id="result" aria-live="polite"></section>
  </div>`;
  if (!isChoice) wireEditor();
  renderResult();
  setPane(ui.pane);
}

function tablesBlock(d) {
  return `<div class="tables"><div class="label">Tables</div>${d.tables.map((name) => {
    const t = TABLES.find((x) => x.name === name);
    return `<details><summary><span class="tname">${t.name}</span> <span class="muted">${t.rows.length} rows</span></summary>
      <p class="about">${esc(t.about)}</p>
      <div class="cols">${t.cols.map(([c, ty]) => `<span>${c}</span><span class="muted">${ty}</span>`).join("")}</div>
      <button class="btn small" data-action="preview" data-table="${t.name}">Preview rows</button>
    </details>`;
  }).join("")}</div>`;
}

function editorBlock(d) {
  const sql = progress.queries[d.id] ?? "";
  const keys = ["SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "OVER (", "PARTITION BY", "QUALIFY", "( )", "'", "=", "*", ","];
  return `<div class="editor">
      <pre class="hl" aria-hidden="true">${highlight(sql)}</pre>
      <textarea id="sql" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Your SQL query"
        placeholder="-- write your query here&#10;SELECT …">${esc(sql)}</textarea>
    </div>
    <div class="keys" aria-label="Insert SQL">${keys.map((k) => `<button class="key" data-action="key" data-key="${esc(k)}" tabindex="-1">${esc(k)}</button>`).join("")}</div>
    <div class="actions">
      <button class="btn" data-action="run" ${ui.busy ? "disabled" : ""}>Run</button>
      <button class="btn primary" data-action="check" ${ui.busy ? "disabled" : ""}>Check answer</button>
      <span class="kbd muted">⌘/Ctrl + Enter runs</span>
    </div>
    <p class="status muted" id="status">${isLoaded() ? "" : "DuckDB (about 7 MB) loads the first time you run something."}</p>`;
}

function choiceBlock(d) {
  return `<div class="options" role="radiogroup" aria-label="Answers">${d.options.map((o, i) =>
    `<button class="option${ui.choice === i ? " on" : ""}" role="radio" aria-checked="${ui.choice === i}" data-action="choose" data-i="${i}">
      <span class="letter">${"ABCD"[i]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div class="actions"><button class="btn primary" data-action="check-choice" ${ui.choice == null ? "disabled" : ""}>Check answer</button></div>`;
}

// ---------------------------------------------------------------- render: results and feedback

// other: rows to compare against, row by row; cells that differ get marked.
function rowsTable(cols, rows, cap = 200, other = null) {
  const num = (v) => v != null && /^-?\d+(\.\d+)?$/.test(v);
  const hot = (i, j) => other && other[i] && String(other[i][j]) !== String(rows[i][j]);
  return `<div class="grid-wrap"><table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, cap).map((r, i) => `<tr>${r.map((v, j) => `<td class="${num(v) ? "r" : ""}${hot(i, j) ? " hot" : ""}">${v == null ? '<span class="null">NULL</span>' : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${rows.length > cap ? `<p class="muted small">Showing ${cap} of ${rows.length} rows.</p>` : ""}`;
}

function renderResult() {
  const el = $("#result");
  if (!el) return;
  const d = byId[ui.id];
  const f = ui.feedback, r = ui.result;
  let html = "";
  if (f) {
    if (f.kind === "ok") {
      const next = nextDrill(d);
      html += `<div class="fb ok"><strong>✓ Correct${f.rows != null ? `: ${f.rows} row${f.rows === 1 ? "" : "s"}, matches the answer` : ""}.</strong>
        ${next ? `<a class="btn small" href="#${next.id}">Next drill →</a>` : ""}</div>`;
    } else if (f.kind === "error") {
      html += `<div class="fb bad"><strong>DuckDB says:</strong><pre>${esc(f.message)}</pre></div>`;
    } else if (f.kind === "wrong-choice") {
      html += `<div class="fb bad"><strong>Not quite.</strong> ${d.hint}</div>`;
    } else {
      const head = {
        columns: `Your result has ${f.rows ? f.userColCount : 0} column${f.userColCount === 1 ? "" : "s"}; the answer has ${f.cols.length}: ${f.cols.map((c) => `<code>${esc(c)}</code>`).join(", ")}.`,
        more: `Close: you got ${f.rows} rows, the answer has ${f.expectedRows}.`,
        fewer: `Close: you got ${f.rows} row${f.rows === 1 ? "" : "s"}, the answer has ${f.expectedRows}.`,
        values: `Right number of rows (${f.rows}), but some values differ.`,
        order: `Right rows, wrong order.`,
      }[f.kind];
      // Same number of rows wrong on each side: they're usually the same rows
      // with a different value, so mark the cells that differ.
      const pair = f.kind === "values" && f.extra?.length === f.missing?.length;
      if (pair) {
        // Line each missing row up with the extra row it shares most cells with.
        const left = [...f.missing];
        f.missing = f.extra.map((x) => {
          let best = 0, score = -1;
          left.forEach((m, i) => { const s = m.filter((v, j) => String(v) === String(x[j])).length; if (s > score) { score = s; best = i; } });
          return left.splice(best, 1)[0];
        });
      }
      html += `<div class="fb bad"><strong>${head}</strong>${d.traps?.[f.kind] ? `<p>${d.traps[f.kind]}</p>` : ""}
        ${f.extra?.length ? `<div class="diff-label">In your result, not in the answer${f.extra.length > 3 ? ` (first 3 of ${f.extra.length})` : ""}</div>${rowsTable(f.cols, f.extra, 3, pair ? f.missing : null)}` : ""}
        ${f.missing?.length ? `<div class="diff-label">In the answer, missing from yours${f.missing.length > 3 ? ` (first 3 of ${f.missing.length})` : ""}</div>${rowsTable(f.cols, f.missing, 3, pair ? f.extra : null)}` : ""}
      </div>`;
    }
  }
  if (r && d.type !== "choice") {
    html += `<div class="result-head"><span class="label">${esc(r.title ?? "Your result")}</span><span class="muted">${r.rows.length} row${r.rows.length === 1 ? "" : "s"}</span></div>${rowsTable(r.cols, r.rows)}`;
  }
  if (!html) html = `<p class="empty muted">${d.type === "choice" ? "Pick an answer, then check it." : "Run a query to see its result here."}</p>`;
  el.innerHTML = html;
}

const nextDrill = (d) => DRILLS.slice(DRILLS.indexOf(d) + 1).find((x) => !progress.solved[x.id]) ?? DRILLS.find((x) => !progress.solved[x.id]);

// ---------------------------------------------------------------- actions

function setBusy(busy, msg = "") {
  ui.busy = busy;
  document.querySelectorAll("[data-action=run],[data-action=check],[data-action=preview]").forEach((b) => { b.disabled = busy; });
  const s = $("#status");
  if (s) s.textContent = msg;
}

async function run(check) {
  const d = byId[ui.id], sql = $("#sql").value;
  setBusy(true, isLoaded() ? "Running…" : "Loading DuckDB (about 7 MB, first time only)…");
  try {
    const mine = await runQuery(sql);
    ui.result = mine;
    if (check) {
      const exp = await runQuery(d.answer);
      const f = compare(mine, exp, d.ordered);
      ui.feedback = { ...f, userColCount: mine.cols.length };
      if (f.ok && !progress.solved[d.id]) { progress.solved[d.id] = true; save(); renderSide(); renderDrill(); }
    } else ui.feedback = null;
    setBusy(false, "");
  } catch (e) {
    ui.result = null;
    ui.feedback = { kind: "error", message: String(e?.message ?? e).replace(/^Error: /, "") };
    setBusy(false, /fetch|network|import/i.test(String(e)) && !isLoaded() ? "Couldn't download DuckDB. Check the connection and try again." : "");
  }
  renderResult();
  if (matchMedia("(max-width: 959px)").matches) setPane("result");
}

async function preview(table) {
  setBusy(true, isLoaded() ? "Running…" : "Loading DuckDB (about 7 MB, first time only)…");
  try {
    ui.result = { ...(await runQuery(`SELECT * FROM ${table} LIMIT 20`)), title: `${table} (first 20 rows)` };
    ui.feedback = null;
    setBusy(false, "");
  } catch (e) {
    ui.feedback = { kind: "error", message: String(e?.message ?? e) };
    setBusy(false, "");
  }
  renderResult();
  if (matchMedia("(max-width: 959px)").matches) setPane("result");
}

function setPane(p) {
  ui.pane = p;
  document.body.dataset.pane = p;
  document.querySelectorAll(".tabs [role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.pane === p)));
}

function wireEditor() {
  const ta = $("#sql"), hl = $(".hl");
  const sync = () => {
    hl.innerHTML = highlight(ta.value);
    hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
    progress.queries[ui.id] = ta.value; save();
  };
  ta.addEventListener("input", sync);
  ta.addEventListener("scroll", () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!ui.busy) run(e.shiftKey); }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); insert("  "); }
  });
}

function insert(text, caretBack = 0) {
  const ta = $("#sql");
  const { selectionStart: a, selectionEnd: b, value } = ta;
  ta.value = value.slice(0, a) + text + value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + text.length - caretBack;
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function go(id) {
  ui.id = byId[id] ? id : progress.last && byId[progress.last] ? progress.last : DRILLS.find((x) => !progress.solved[x.id])?.id ?? DRILLS[0].id;
  progress.last = ui.id; save();
  ui.hint = false; ui.result = null; ui.feedback = null; ui.choice = null; ui.pane = "task";
  document.body.classList.remove("side-open");
  renderSide(); renderDrill();
  window.scrollTo(0, 0);
}

document.addEventListener("mousedown", (e) => {
  // Keep the keyboard up and the cursor in place when tapping a SQL key.
  if (e.target.closest(".key")) e.preventDefault();
});

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tabs [role=tab]");
  if (tab) { setPane(tab.dataset.pane); return; }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const d = byId[ui.id], a = el.dataset.action;
  if (a === "run") run(false);
  else if (a === "check") run(true);
  else if (a === "preview") preview(el.dataset.table);
  else if (a === "hint") { ui.hint = !ui.hint; renderDrill(); }
  else if (a === "reveal") {
    if (confirm("Show the answer? You can still solve it yourself afterwards.")) { progress.revealed[d.id] = true; save(); renderDrill(); }
  } else if (a === "use-answer") {
    progress.queries[d.id] = d.answer; save(); renderDrill(); setPane("query");
  } else if (a === "key") {
    const k = el.dataset.key;
    if (k === "( )") insert("()", 1);
    else if (k === "'") insert("''", 1);
    else insert(/^[A-Z]/.test(k) ? `${k} `.replace("( ", "(") : k === "," ? ", " : ` ${k} `);
  } else if (a === "choose") { ui.choice = +el.dataset.i; ui.feedback = null; renderDrill(); setPane(ui.pane); }
  else if (a === "check-choice") {
    if (ui.choice === d.correct) {
      ui.feedback = { kind: "ok" };
      if (!progress.solved[d.id]) { progress.solved[d.id] = true; save(); renderSide(); }
      renderDrill();
    } else { ui.feedback = { kind: "wrong-choice" }; renderResult(); }
    if (matchMedia("(max-width: 959px)").matches) setPane("result");
  } else if (a === "open-side") document.body.classList.add("side-open");
  else if (a === "close-side") document.body.classList.remove("side-open");
  else if (a === "reset-progress") {
    if (confirm("Clear every solved mark and saved query on this device?")) {
      progress = { version: 1, solved: {}, revealed: {}, queries: {}, last: null }; save(); go(DRILLS[0].id);
    }
  }
});

window.addEventListener("hashchange", () => go(location.hash.slice(1)));
go(location.hash.slice(1));
