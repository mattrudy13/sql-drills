// The practice database: a small, made-up bank. Every name, number and city is
// invented. Some rows are planted on purpose so a drill's trap actually bites
// (a tie, a NULL, a same-day pair, a missing month). The comments say which.
//
// Built in JS with a seeded random generator, then written out as SQL, so the
// browser and the Node tests load exactly the same rows.

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const pad = (n) => String(n).padStart(2, "0");

export const customers = [
  // [customer_id, name, state, joined_on, email]  (3 emails are NULL: drill A1)
  [1, "Avery Brooks", "NC", "2019-04-11", "avery.b@example.com"],
  [2, "Jordan Ellis", "NC", "2020-08-02", "jordan.e@example.com"],
  [3, "Sam Okafor", "SC", "2018-01-23", null],
  [4, "Riley Chen", "GA", "2021-11-30", "riley.c@example.com"],
  [5, "Morgan Patel", "SC", "2017-06-15", "morgan.p@example.com"],
  [6, "Casey Nguyen", "GA", "2022-03-09", null],
  [7, "Taylor Reyes", "TN", "2016-09-27", "taylor.r@example.com"],
  [8, "Quinn Foster", "TN", "2023-02-14", "quinn.f@example.com"],
  [9, "Drew Alvarez", "NC", "2020-05-05", "drew.a@example.com"],
  [10, "Jamie Kowalski", "GA", "2019-12-01", null],
  [11, "Parker Hughes", "SC", "2024-01-08", "parker.h@example.com"],
  [12, "Rowan Sato", "TN", "2026-05-20", "rowan.s@example.com"], // no accounts yet: drills J2, J3
];

export const branches = [
  [1, "East", "Riverside"],
  [2, "East", "Harbor Point"],
  [3, "West", "Maple Grove"],
  [4, "West", "Cedar Falls"],
];

export const accounts = [
  // [account_id, customer_id, branch_id, type, opened_on, monthly_fee]  NULL fee = no fee plan: drill A3
  [101, 1, 1, "checking", "2019-04-11", 12.0],
  [102, 1, 1, "card", "2020-02-01", null],
  [103, 2, 2, "checking", "2020-08-02", 12.0],
  [104, 2, 2, "card", "2021-05-17", null],
  [105, 3, 1, "card", "2018-03-01", null],
  [106, 3, 1, "checking", "2018-01-23", 5.0],
  [107, 4, 3, "checking", "2021-11-30", null],
  [108, 5, 3, "checking", "2017-06-15", 12.0],
  [109, 5, 3, "savings", "2017-06-15", null],
  [110, 6, 4, "savings", "2022-03-09", 0.0], // only deposits: drill A4
  [111, 7, 4, "checking", "2016-09-27", 5.0],
  [112, 8, 2, "card", "2023-02-14", null],
  [113, 9, 2, "checking", "2020-05-05", 12.0],
  [114, 10, 4, "checking", "2019-12-01", null],
  [115, 11, 1, "checking", "2024-01-08", 5.0], // activity stops after March: drill J3
  [116, 4, 3, "savings", "2025-10-01", null], // never used: drill J1
];

// Transactions, January–June 2026. amount is always positive; direction says
// which way the money moved.
function buildTransactions() {
  const r = rng(11);
  const cents = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const rows = [];
  const add = (account_id, date, direction, amount, merchant, category) =>
    rows.push({ account_id, date, direction, amount, merchant, category });
  const day = (m, d) => `2026-${pad(m)}-${pad(Math.min(d, 28))}`;

  const type = Object.fromEntries(accounts.map((a) => [a[0], a[3]]));
  for (let m = 1; m <= 6; m++) {
    for (const [id] of accounts) {
      if (id === 116) continue;
      if (id === 115 && m > 3) continue;
      const t = type[id];
      if (t === "savings") { add(id, day(m, 3), "credit", cents(150, 600), "Transfer in", "Transfer"); continue; }
      if (t === "checking") {
        add(id, day(m, 1), "credit", cents(2200, 3400), "Payroll - Acme Co", "Income");
        if (id === 106 && m === 3) continue; // no spending in March: drill W5
        add(id, day(m, 18), "debit", cents(70, 160), "City Power", "Utilities");
        for (let k = 0; k < 3 + Math.floor(r() * 3); k++) add(id, day(m, 2 + Math.floor(r() * 26)), "debit", cents(18, 140), "Fresh Mart", "Groceries");
        for (let k = 0; k < 2 + Math.floor(r() * 3); k++) add(id, day(m, 2 + Math.floor(r() * 26)), "debit", cents(9, 65), "Corner Cafe", "Dining");
        if (r() < 0.35) add(id, day(m, 5 + Math.floor(r() * 20)), "debit", cents(510, 900), "Shopwell", "Shopping");
      } else { // card
        for (let k = 0; k < 4 + Math.floor(r() * 4); k++) add(id, day(m, 2 + Math.floor(r() * 26)), "debit", cents(12, 220), "Shopwell", "Shopping");
        for (let k = 0; k < 2 + Math.floor(r() * 3); k++) add(id, day(m, 2 + Math.floor(r() * 26)), "debit", cents(14, 90), "Corner Cafe", "Dining");
        if (r() < 0.5) add(id, day(m, 2 + Math.floor(r() * 26)), "debit", cents(25, 120), "Fresh Mart", "Groceries");
      }
    }
  }
  // Planted rows.
  add(101, "2026-01-09", "debit", 42.1, "Fresh Mart", "Groceries"); // two on one day: drill W2
  add(101, "2026-01-09", "debit", 17.35, "Corner Cafe", "Dining");
  add(104, "2026-02-11", "debit", 412.6, "Northline Air", "Travel"); // tie for the top: drill W3
  add(112, "2026-04-02", "debit", 412.6, "Northline Air", "Travel");
  add(105, "2026-05-21", "debit", 380.0, "Bayside Hotel", "Travel");
  add(102, "2026-03-07", "debit", 129.99, "Northline Air", "Travel");
  add(103, "2026-03-15", "debit", 64.25, "Fresh Mart", "Groceries"); // on the tier-change day: drill J4
  add(104, "2026-03-20", "credit", 45.0, "Shopwell", "Shopping"); // a refund

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.account_id - b.account_id);
  return rows.map((x, i) => [i + 1, x.account_id, x.date, x.direction, x.amount, x.merchant, x.category]);
}
export const transactions = buildTransactions();

export const accountHistory = [
  // [account_id, as_of_date, balance, updated_at]
  [101, "2026-06-02", 3120.4, "2026-06-02 18:00:00"],
  [101, "2026-06-16", 3640.0, "2026-06-16 18:00:00"],
  [101, "2026-06-30", 4210.55, "2026-06-30 18:00:00"],
  [102, "2026-05-31", 210.0, "2026-05-31 18:00:00"],
  [102, "2026-06-12", 88.1, "2026-06-12 18:00:00"],
  [103, "2026-06-10", 14650.0, "2026-06-10 18:00:00"],
  [103, "2026-06-29", 14990.0, "2026-06-29 09:15:00"], // two rows on its latest date: drill W1
  [103, "2026-06-29", 15002.0, "2026-06-29 17:40:00"],
  [104, "2026-04-30", 512.75, "2026-04-30 18:00:00"],
  [104, "2026-05-02", 0.0, "2026-05-02 18:00:00"],
];

export const customerHistory = [
  // [customer_id, tier, valid_from, valid_to]  valid_to is exclusive; NULL = current
  ...customers.filter((c) => c[0] !== 2).map((c) => [c[0], c[0] % 3 === 0 ? "Gold" : "Standard", c[3], null]),
  [2, "Standard", "2020-08-02", "2026-03-15"], // changes on a day with a transaction: drill J4
  [2, "Gold", "2026-03-15", "2026-05-20"],
  [2, "Platinum", "2026-05-20", null],
].sort((a, b) => a[0] - b[0] || a[2].localeCompare(b[2]));

export const fraudFlags = [
  // [flag_id, customer_id, flagged_on, reason]  one flag has no customer: drill A2
  [1, 4, "2026-02-03", "card testing"],
  [2, 9, "2026-03-28", "velocity"],
  [3, null, "2026-04-14", "unmatched device"],
  [4, 4, "2026-05-30", "card testing"],
];

export const transactionsRaw = [
  // [txn_id, account_id, amount, loaded_at]  a nightly load that ran twice: drill J5
  [9001, 101, 54.1, "2026-07-01 02:00:00"],
  [9002, 101, 12.75, "2026-07-01 02:00:00"],
  [9003, 103, 220.0, "2026-07-01 02:00:00"],
  [9004, 104, 31.5, "2026-07-01 02:00:00"],
  [9005, 105, 89.9, "2026-07-01 02:00:00"],
  [9006, 107, 410.0, "2026-07-01 02:00:00"],
  [9007, 108, 15.0, "2026-07-01 02:00:00"],
  [9008, 113, 67.2, "2026-07-01 02:00:00"],
  [9003, 103, 202.0, "2026-07-02 02:00:00"], // corrected amount
  [9005, 105, 89.9, "2026-07-02 02:00:00"], // exact repeat
  [9006, 107, 41.0, "2026-07-02 02:00:00"], // corrected amount
];

// What the page shows under "Tables", and the column types for CREATE TABLE.
export const TABLES = [
  { name: "customers", about: "One row per customer.", cols: [["customer_id", "INTEGER"], ["name", "VARCHAR"], ["state", "VARCHAR"], ["joined_on", "DATE"], ["email", "VARCHAR"]], rows: customers },
  { name: "branches", about: "Where an account was opened.", cols: [["branch_id", "INTEGER"], ["region", "VARCHAR"], ["city", "VARCHAR"]], rows: branches },
  { name: "accounts", about: "Checking, savings and card accounts. monthly_fee is NULL when the account has no fee plan.", cols: [["account_id", "INTEGER"], ["customer_id", "INTEGER"], ["branch_id", "INTEGER"], ["type", "VARCHAR"], ["opened_on", "DATE"], ["monthly_fee", "DECIMAL(8,2)"]], rows: accounts },
  { name: "transactions", about: "January–June 2026. amount is always positive; direction is 'debit' (money out) or 'credit' (money in).", cols: [["txn_id", "INTEGER"], ["account_id", "INTEGER"], ["txn_date", "DATE"], ["direction", "VARCHAR"], ["amount", "DECIMAL(12,2)"], ["merchant", "VARCHAR"], ["category", "VARCHAR"]], rows: transactions },
  { name: "account_history", about: "A balance snapshot whenever an account's balance changed. updated_at says when the snapshot was written.", cols: [["account_id", "INTEGER"], ["as_of_date", "DATE"], ["balance", "DECIMAL(12,2)"], ["updated_at", "TIMESTAMP"]], rows: accountHistory },
  { name: "customer_history", about: "Customer tier over time (type 2 slowly changing dimension). valid_to is exclusive; NULL means current.", cols: [["customer_id", "INTEGER"], ["tier", "VARCHAR"], ["valid_from", "DATE"], ["valid_to", "DATE"]], rows: customerHistory },
  { name: "fraud_flags", about: "Fraud alerts. customer_id is NULL when the alert couldn't be matched to a customer.", cols: [["flag_id", "INTEGER"], ["customer_id", "INTEGER"], ["flagged_on", "DATE"], ["reason", "VARCHAR"]], rows: fraudFlags },
  { name: "transactions_raw", about: "A staging table: the nightly load, which sometimes runs twice. A later load of the same txn_id replaces the earlier one.", cols: [["txn_id", "INTEGER"], ["account_id", "INTEGER"], ["amount", "DECIMAL(12,2)"], ["loaded_at", "TIMESTAMP"]], rows: transactionsRaw },
];

// CREATE OR REPLACE, so running it again resets anything a query changed.
export const SETUP_SQL = TABLES.map((t) => {
  const cols = t.cols.map(([n, ty]) => `${n} ${ty}`).join(", ");
  const values = t.rows.map((r) => `(${r.map((v, i) => {
    const ty = t.cols[i][1];
    if (v == null) return "NULL";
    if (ty === "DATE") return `DATE ${q(v)}`;
    if (ty === "TIMESTAMP") return `TIMESTAMP ${q(v)}`;
    return q(v);
  }).join(", ")})`).join(",\n");
  return `CREATE OR REPLACE TABLE ${t.name} (${cols});\nINSERT INTO ${t.name} VALUES\n${values};`;
}).join("\n");
