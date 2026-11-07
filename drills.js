// The drills. Each SQL drill has:
//   task    what to return (HTML)
//   answer  the reference query; the checker compares results, not SQL text
//   ordered true when row order is part of the answer
//   hint    a nudge, shown on request
//   traps   what to say when a check fails: more rows, fewer rows, wrong values, wrong order
//   why     the "why it works" note, shown once solved or after Show answer
//   wrong   common wrong answers. Never shown; the tests run them to prove the
//           data really catches each mistake.
// Query-cost drills are multiple choice ("which plan is faster and why"),
// because a laptop browser can't show what a Spark cluster does.

export const TOPICS = [
  { id: "windows", name: "Window functions" },
  { id: "joins", name: "Joins & duplicates" },
  { id: "nulls", name: "Aggregation & NULLs" },
  { id: "cost", name: "Query cost (Spark)" },
];

const c = (s) => `<code>${s}</code>`;

export const DRILLS = [
  // ------------------------------------------------------------ windows
  {
    id: "w1", topic: "windows", title: "Latest row per key",
    task: `Return each account's latest balance from ${c("account_history")}: one row per account, with ${c("account_id")}, ${c("balance")} and ${c("as_of_date")}. If an account has two snapshots on its latest date, the one with the later ${c("updated_at")} wins.`,
    tables: ["account_history"],
    answer: `SELECT account_id, balance, as_of_date
FROM account_history
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY account_id
  ORDER BY as_of_date DESC, updated_at DESC
) = 1`,
    hint: `A GROUP BY can find the latest date, but not the balance on that row. Number the rows inside each account, newest first, and keep row 1.`,
    traps: {
      more: `Account 103 has two snapshots on 2026-06-29. Ordered by date alone they tie, and RANK keeps both. Add ${c("updated_at DESC")} to the ORDER BY so exactly one row is newest.`,
      fewer: `Every account in account_history should appear once.`,
      values: `Check the tie-breaker: the later updated_at wins, so 103 should show 15,002.00.`,
    },
    why: `<p>GROUP BY collapses rows, so it can tell you <em>when</em> each account last changed but not <em>which row</em> that was. A window function keeps every row and adds a number to it: ${c("ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY …)")} counts 1, 2, 3 inside each account. Keeping 1 keeps the whole newest row.</p>
<p>Rule of thumb: <strong>use a window when you need a value from a specific row; use GROUP BY when you need a total.</strong></p>
<p>${c("QUALIFY")} filters on a window result the way HAVING filters on an aggregate. Databricks SQL supports it too. Without it you'd wrap the query in a CTE and filter ${c("WHERE rn = 1")}.</p>`,
    wrong: [
      `SELECT account_id, balance, as_of_date FROM account_history QUALIFY RANK() OVER (PARTITION BY account_id ORDER BY as_of_date DESC) = 1`,
      `SELECT h.account_id, h.balance, h.as_of_date FROM account_history h JOIN (SELECT account_id, MAX(as_of_date) d FROM account_history GROUP BY 1) m ON m.account_id = h.account_id AND m.d = h.as_of_date`,
    ],
  },
  {
    id: "w2", topic: "windows", title: "Running total",
    task: `For account 101 in January 2026, list every transaction with a running total of its signed amount (credits add, debits subtract). Return ${c("txn_id")}, ${c("txn_date")}, ${c("signed_amount")} and ${c("running_total")}, oldest first. When two transactions share a date, the lower txn_id comes first.`,
    tables: ["transactions"],
    ordered: true,
    answer: `SELECT
  txn_id,
  txn_date,
  CASE WHEN direction = 'credit' THEN amount ELSE -amount END AS signed_amount,
  SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
    OVER (ORDER BY txn_date, txn_id) AS running_total
FROM transactions
WHERE account_id = 101
  AND txn_date >= DATE '2026-01-01' AND txn_date < DATE '2026-02-01'
ORDER BY txn_date, txn_id`,
    hint: `SUM(…) OVER (ORDER BY …) gives a running total. Think about what happens when two rows have the same txn_date.`,
    traps: {
      values: `Look at January 9: two transactions show the same running total. With ${c("ORDER BY txn_date")} alone, the default frame is <em>RANGE</em> up to the current row, which includes every row tied on that date. Order by ${c("txn_date, txn_id")}, or say ${c("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW")}.`,
      order: `Sort the output by txn_date, then txn_id.`,
      more: `Only account 101, and only January 2026.`,
      fewer: `Only account 101, and only January 2026 (every transaction in it).`,
    },
    why: `<p>A window with ORDER BY but no frame clause uses <strong>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</strong>. RANGE means "every row whose ORDER BY value is ≤ mine", so rows that tie on the date are all counted at once and get the same total.</p>
<p><strong>ROWS</strong> counts physical rows instead: exactly the ones before this one. Making the ORDER BY unique (adding txn_id) has the same effect and also makes the result repeatable, which matters in Spark, where tied rows can come back in a different order on each run.</p>`,
    wrong: [
      `SELECT txn_id, txn_date, CASE WHEN direction='credit' THEN amount ELSE -amount END AS signed_amount, SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) OVER (ORDER BY txn_date) AS running_total FROM transactions WHERE account_id = 101 AND txn_date < DATE '2026-02-01' ORDER BY txn_date, txn_id`,
    ],
  },
  {
    id: "w3", topic: "windows", title: "Ties: RANK vs DENSE_RANK",
    task: `For each category, find the debit transactions with the <strong>two highest distinct amounts</strong>. Ties count: if two purchases share the top amount, both are #1 and the next amount is still #2. Return ${c("category")}, ${c("txn_id")} and ${c("amount")}.`,
    tables: ["transactions"],
    answer: `SELECT category, txn_id, amount
FROM transactions
WHERE direction = 'debit'
QUALIFY DENSE_RANK() OVER (PARTITION BY category ORDER BY amount DESC) <= 2`,
    hint: `ROW_NUMBER, RANK and DENSE_RANK only differ when there are ties. Which one numbers the next amount after a tie as 2?`,
    traps: {
      fewer: `Travel has two purchases of 412.60. RANK numbers them 1, 1 and then jumps to 3, so 380.00 drops out. DENSE_RANK numbers the next distinct amount 2.`,
      more: `Only debits, and only the top two distinct amounts in each category.`,
    },
    why: `<p>For the amounts 412.60, 412.60, 380.00:</p>
<ul><li>${c("ROW_NUMBER")}: 1, 2, 3 (ties broken arbitrarily)</li><li>${c("RANK")}: 1, 1, 3 (skips after a tie, like a race with two golds and no silver)</li><li>${c("DENSE_RANK")}: 1, 1, 2 (no gaps)</li></ul>
<p>Pick by the question: "top N rows" → ROW_NUMBER; "everyone who'd place in the top N" → RANK; "the top N distinct values" → DENSE_RANK.</p>`,
    wrong: [
      `SELECT category, txn_id, amount FROM transactions WHERE direction='debit' QUALIFY RANK() OVER (PARTITION BY category ORDER BY amount DESC) <= 2`,
      `SELECT category, txn_id, amount FROM transactions WHERE direction='debit' QUALIFY ROW_NUMBER() OVER (PARTITION BY category ORDER BY amount DESC) <= 2`,
    ],
  },
  {
    id: "w4", topic: "windows", title: "Month over month (LAG)",
    task: `For card accounts 104 and 105, total the debits per calendar month (January–June 2026) and show the change from <em>the same account's</em> previous month. Return ${c("account_id")}, ${c("month")} (the first day of the month), ${c("spend")} and ${c("change")}. ${c("change")} is NULL in each account's first month.`,
    tables: ["transactions"],
    answer: `WITH monthly AS (
  SELECT
    account_id,
    CAST(date_trunc('month', txn_date) AS DATE) AS month,
    SUM(amount) AS spend
  FROM transactions
  WHERE account_id IN (104, 105) AND direction = 'debit'
  GROUP BY ALL
)
SELECT
  account_id, month, spend,
  spend - LAG(spend) OVER (PARTITION BY account_id ORDER BY month) AS change
FROM monthly`,
    hint: `Total by month first (a CTE), then use LAG(spend) to reach the previous row. Make sure "previous" can't cross from one account into the other.`,
    traps: {
      values: `Account 105's first month should have no change. Without ${c("PARTITION BY account_id")}, LAG reaches back into account 104's last month.`,
      more: `One row per account per month: total the debits by month before using LAG.`,
    },
    why: `<p>${c("LAG(x)")} reads x from the row before this one; ${c("LEAD(x)")} reads the row after. "Before" is defined by the window's ORDER BY, and PARTITION BY puts walls between groups so the first row of each account gets NULL instead of the last row of another account.</p>
<p>Pattern: aggregate to one row per period first, then window over the periods. ${c("GROUP BY ALL")} (DuckDB and Databricks) groups by every non-aggregated column so you don't repeat them.</p>`,
    wrong: [
      `WITH m AS (SELECT account_id, CAST(date_trunc('month', txn_date) AS DATE) AS month, SUM(amount) AS spend FROM transactions WHERE account_id IN (104,105) AND direction='debit' GROUP BY ALL) SELECT account_id, month, spend, spend - LAG(spend) OVER (ORDER BY account_id, month) AS change FROM m`,
    ],
  },
  {
    id: "w5", topic: "windows", title: "Moving average with a gap",
    task: `Account 106 is a checking account. For each month from January to June 2026, show its debit ${c("spend")} and ${c("avg_3m")}: the average of this month and the two before it. A month with no spending counts as 0 and still takes a slot. January averages just January; February averages January and February. Return ${c("month")} (first day of the month), ${c("spend")} and ${c("avg_3m")}.`,
    tables: ["transactions"],
    answer: `WITH months AS (
  SELECT CAST(m AS DATE) AS month
  FROM range(DATE '2026-01-01', DATE '2026-07-01', INTERVAL 1 MONTH) AS t(m)
),
spend AS (
  SELECT CAST(date_trunc('month', txn_date) AS DATE) AS month, SUM(amount) AS spend
  FROM transactions
  WHERE account_id = 106 AND direction = 'debit'
  GROUP BY 1
)
SELECT
  month,
  COALESCE(spend.spend, 0) AS spend,
  AVG(COALESCE(spend.spend, 0)) OVER (
    ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
  ) AS avg_3m
FROM months
LEFT JOIN spend USING (month)`,
    hint: `Group by month and see which month is missing. Build the full list of six months first (DuckDB: range(); Spark: sequence() + explode()), then LEFT JOIN the spending onto it.`,
    traps: {
      fewer: `March has no spending, so GROUP BY never produces a March row. Build the list of months first and LEFT JOIN the spending onto it.`,
      values: `${c("ROWS BETWEEN 2 PRECEDING")} counts rows, not months. With March missing, April's window reaches back to January. Fill the gap with a 0 row first.`,
    },
    why: `<p>Window frames count <em>rows</em>. If a period has no data, there's no row, and "the two before" silently becomes a wider stretch of time. The fix is a <strong>date spine</strong>: generate every period, LEFT JOIN the facts onto it, and COALESCE the gaps to 0. Then each row really is one month.</p>
<p>In Spark: ${c("SELECT explode(sequence(DATE'2026-01-01', DATE'2026-06-01', INTERVAL 1 MONTH)) AS month")}.</p>`,
    wrong: [
      `WITH s AS (SELECT CAST(date_trunc('month', txn_date) AS DATE) AS month, SUM(amount) AS spend FROM transactions WHERE account_id = 106 AND direction='debit' GROUP BY 1) SELECT month, spend, AVG(spend) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS avg_3m FROM s`,
    ],
  },

  // ------------------------------------------------------------ joins
  {
    id: "j1", topic: "joins", title: "The join that multiplies",
    task: `For every customer who has at least one account, return ${c("customer_id")}, ${c("accounts")} (how many accounts they have) and ${c("txns")} (how many transactions across those accounts). An account with no transactions still counts as an account.`,
    tables: ["accounts", "transactions"],
    answer: `SELECT
  a.customer_id,
  COUNT(DISTINCT a.account_id) AS accounts,
  COUNT(t.txn_id) AS txns
FROM accounts a
LEFT JOIN transactions t ON t.account_id = a.account_id
GROUP BY a.customer_id`,
    hint: `After joining accounts to transactions, each account appears once per transaction. What does COUNT(a.account_id) count then?`,
    traps: {
      values: `If ${c("accounts")} looks like a transaction count, the join multiplied the rows: each account now appears once per transaction. ${c("COUNT(DISTINCT account_id)")} counts each account once. Also, customer 4's savings account (116) has no transactions, so an inner join drops it.`,
      fewer: `Every customer with an account belongs here. An inner join drops accounts with no transactions, and customers whose only accounts have none.`,
    },
    why: `<p>Every join has a <strong>grain</strong>: what one row means. accounts is one row per account; after joining transactions it's one row per transaction. Any count or sum of account-level columns is now multiplied by the number of transactions. This "fan-out" is the most common cause of totals that are quietly too big.</p>
<p>Two fixes: count DISTINCT keys, or (better for sums) aggregate the many-side to the grain you want <em>before</em> joining.</p>`,
    wrong: [
      `SELECT a.customer_id, COUNT(a.account_id) AS accounts, COUNT(t.txn_id) AS txns FROM accounts a LEFT JOIN transactions t ON t.account_id = a.account_id GROUP BY 1`,
      `SELECT a.customer_id, COUNT(DISTINCT a.account_id) AS accounts, COUNT(t.txn_id) AS txns FROM accounts a JOIN transactions t ON t.account_id = a.account_id GROUP BY 1`,
    ],
  },
  {
    id: "j2", topic: "joins", title: "LEFT JOIN that turns INNER",
    task: `List <strong>every</strong> customer (all 12) with their total debit spending in June 2026 as ${c("june_spend")}. Customers who spent nothing in June show 0. Return ${c("customer_id")} and ${c("june_spend")}.`,
    tables: ["customers", "accounts", "transactions"],
    answer: `SELECT c.customer_id, COALESCE(SUM(t.amount), 0) AS june_spend
FROM customers c
LEFT JOIN accounts a ON a.customer_id = c.customer_id
LEFT JOIN transactions t
  ON t.account_id = a.account_id
  AND t.direction = 'debit'
  AND t.txn_date >= DATE '2026-06-01' AND t.txn_date < DATE '2026-07-01'
GROUP BY c.customer_id`,
    hint: `Count your rows. If customers are missing, look at where the June filter sits: WHERE or ON?`,
    traps: {
      fewer: `A condition on the right-hand table in WHERE throws away the rows the LEFT JOIN kept for customers with no match (their transaction columns are NULL, and NULL fails the test). Move the June and debit conditions into the ON clause.`,
      values: `Customers with no June spending should show 0, not NULL: wrap the SUM in ${c("COALESCE(…, 0)")}.`,
    },
    why: `<p>The ON clause decides <em>which rows match</em>; WHERE decides <em>which rows survive</em>. A LEFT JOIN keeps unmatched customers by filling the right side with NULLs, and then ${c("WHERE t.txn_date >= …")} is NULL for them, so they're dropped. The query is now an inner join in disguise.</p>
<p>Conditions on the optional (right) table go in ON. Conditions on the table you're keeping (left) can go in WHERE.</p>`,
    wrong: [
      `SELECT c.customer_id, COALESCE(SUM(t.amount), 0) AS june_spend FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id LEFT JOIN transactions t ON t.account_id = a.account_id WHERE t.direction = 'debit' AND t.txn_date >= DATE '2026-06-01' AND t.txn_date < DATE '2026-07-01' GROUP BY 1`,
      `SELECT c.customer_id, SUM(t.amount) AS june_spend FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id LEFT JOIN transactions t ON t.account_id = a.account_id AND t.direction='debit' AND t.txn_date >= DATE '2026-06-01' AND t.txn_date < DATE '2026-07-01' GROUP BY 1`,
    ],
  },
  {
    id: "j3", topic: "joins", title: "Who did nothing? (anti-join)",
    task: `Find customers who made <strong>no transactions at all</strong> from April 1 to June 30, 2026, including customers who don't have an account. Return ${c("customer_id")} and ${c("name")}.`,
    tables: ["customers", "accounts", "transactions"],
    answer: `SELECT c.customer_id, c.name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM accounts a
  JOIN transactions t ON t.account_id = a.account_id
  WHERE a.customer_id = c.customer_id
    AND t.txn_date >= DATE '2026-04-01' AND t.txn_date < DATE '2026-07-01'
)`,
    hint: `Start from customers, not accounts, and ask "does a matching transaction exist?" NOT EXISTS or a LEFT JOIN … WHERE key IS NULL both work.`,
    traps: {
      fewer: `Rowan Sato (12) has no accounts. Starting from accounts, or inner-joining them, drops anyone without one.`,
      more: `Only customers with zero transactions from April 1 to June 30 belong here.`,
    },
    why: `<p>An <strong>anti-join</strong> keeps rows that have no match. ${c("NOT EXISTS")} says it directly and stops at the first match it finds. ${c("LEFT JOIN … WHERE t.txn_id IS NULL")} does the same. Spark SQL also has ${c("LEFT ANTI JOIN")}, which compiles to the same plan.</p>
<p>Avoid ${c("NOT IN (subquery)")} for this: if the subquery returns a single NULL, it returns nothing. That's a drill in the NULLs topic.</p>`,
    wrong: [
      `SELECT c.customer_id, c.name FROM customers c JOIN accounts a ON a.customer_id = c.customer_id LEFT JOIN transactions t ON t.account_id = a.account_id AND t.txn_date >= DATE '2026-04-01' GROUP BY 1, 2 HAVING COUNT(t.txn_id) = 0`,
    ],
  },
  {
    id: "j4", topic: "joins", title: "As-of join to history (SCD2)",
    task: `For every transaction on account 103 in March 2026, show ${c("txn_id")}, ${c("txn_date")} and the ${c("tier")} the account's customer had <em>on that date</em>. In ${c("customer_history")}, ${c("valid_from")} is inclusive and ${c("valid_to")} is exclusive (NULL means still current).`,
    tables: ["transactions", "accounts", "customer_history"],
    answer: `SELECT t.txn_id, t.txn_date, h.tier
FROM transactions t
JOIN accounts a ON a.account_id = t.account_id
JOIN customer_history h
  ON h.customer_id = a.customer_id
  AND t.txn_date >= h.valid_from
  AND (h.valid_to IS NULL OR t.txn_date < h.valid_to)
WHERE t.account_id = 103
  AND t.txn_date >= DATE '2026-03-01' AND t.txn_date < DATE '2026-04-01'`,
    hint: `Join on the customer AND on the date falling inside the history row's range. Mind which end of the range is exclusive.`,
    traps: {
      more: `The transaction on March 15 matched two tiers. BETWEEN includes both ends, but valid_to is exclusive: use ${c("txn_date < valid_to")}.`,
      values: `Use the tier in effect on each transaction's date, not the current tier (Platinum).`,
      fewer: `Every March transaction on account 103 should appear once. Remember that valid_to is NULL for the current row.`,
    },
    why: `<p>A type 2 history table keeps one row per version with a validity range. To get the version that applied at a moment, join on the key <em>and</em> ${c("valid_from <= d AND d < valid_to")}.</p>
<p>Half-open ranges ([from, to)) are the standard because the next row's valid_from equals this row's valid_to: every date falls in exactly one row. BETWEEN is inclusive on both ends, so the change date matches two rows and the transaction is duplicated.</p>`,
    wrong: [
      `SELECT t.txn_id, t.txn_date, h.tier FROM transactions t JOIN accounts a USING (account_id) JOIN customer_history h ON h.customer_id = a.customer_id AND t.txn_date BETWEEN h.valid_from AND COALESCE(h.valid_to, DATE '9999-12-31') WHERE t.account_id = 103 AND t.txn_date >= DATE '2026-03-01' AND t.txn_date < DATE '2026-04-01'`,
      `SELECT t.txn_id, t.txn_date, h.tier FROM transactions t JOIN accounts a USING (account_id) JOIN customer_history h ON h.customer_id = a.customer_id AND h.valid_to IS NULL WHERE t.account_id = 103 AND t.txn_date >= DATE '2026-03-01' AND t.txn_date < DATE '2026-04-01'`,
    ],
  },
  {
    id: "j5", topic: "joins", title: "Dedupe a double load",
    task: `${c("transactions_raw")} holds the nightly load, and some nights it ran twice. Keep only the <strong>latest load</strong> of each txn_id. Return ${c("txn_id")}, ${c("account_id")} and ${c("amount")}: one row per txn_id.`,
    tables: ["transactions_raw"],
    answer: `SELECT txn_id, account_id, amount
FROM transactions_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY txn_id ORDER BY loaded_at DESC) = 1`,
    hint: `SELECT DISTINCT only helps when the copies are identical. Are they?`,
    traps: {
      more: `SELECT DISTINCT only removes rows that match in every column. 9003 and 9006 were corrected on the second load, so both versions survive.`,
      values: `The later loaded_at wins: 9003 should be 202.00 and 9006 should be 41.00.`,
    },
    why: `<p>Duplicates from reloads usually aren't identical: a later load fixes an amount, or adds a timestamp. Deduping means choosing one row per business key with a rule ("latest load wins"), which is ROW_NUMBER over the key ordered by the rule.</p>
<p>In Delta, the lasting fix is to load with ${c("MERGE INTO … WHEN MATCHED THEN UPDATE")} on txn_id, so the table never holds two versions in the first place.</p>`,
    wrong: [
      `SELECT DISTINCT txn_id, account_id, amount FROM transactions_raw`,
      `SELECT txn_id, account_id, MAX(amount) AS amount FROM transactions_raw GROUP BY 1, 2`,
    ],
  },

  // ------------------------------------------------------------ nulls
  {
    id: "n1", topic: "nulls", title: "COUNT(*) vs COUNT(column)",
    task: `How many customers have an email on file, and how many don't? Return one row with ${c("with_email")} and ${c("without_email")}.`,
    tables: ["customers"],
    answer: `SELECT
  COUNT(email) AS with_email,
  COUNT(*) - COUNT(email) AS without_email
FROM customers`,
    hint: `COUNT(*) counts rows. COUNT(email) counts something else.`,
    traps: {
      values: `${c("email = NULL")} is never true (it's NULL), so a CASE on it counts nothing. Use ${c("email IS NULL")}. And ${c("COUNT(email)")} already skips NULLs; ${c("COUNT(*)")} counts every row.`,
      more: `One row with two numbers.`,
    },
    why: `<p>SQL has three truth values: TRUE, FALSE and NULL ("unknown"). Any comparison with NULL, even ${c("NULL = NULL")}, is NULL, and WHERE and CASE treat NULL like FALSE. That's why ${c("IS NULL")} exists.</p>
<p>${c("COUNT(*)")} counts rows; ${c("COUNT(col)")} counts non-NULL values; ${c("COUNT(DISTINCT col)")} counts distinct non-NULL values.</p>`,
    wrong: [
      `SELECT COUNT(email) AS with_email, COUNT(CASE WHEN email = NULL THEN 1 END) AS without_email FROM customers`,
      `SELECT COUNT(*) AS with_email, COUNT(*) - COUNT(email) AS without_email FROM customers`,
    ],
  },
  {
    id: "n2", topic: "nulls", title: "NOT IN and one NULL",
    task: `List customers who have <strong>never</strong> been flagged for fraud. Return ${c("customer_id")} and ${c("name")}.`,
    tables: ["customers", "fraud_flags"],
    answer: `SELECT c.customer_id, c.name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM fraud_flags f WHERE f.customer_id = c.customer_id
)`,
    hint: `Try NOT IN first and look at the row count. Then look at every customer_id in fraud_flags.`,
    traps: {
      fewer: `No rows? fraud_flags has an alert with customer_id NULL. ${c("x NOT IN (4, 9, NULL)")} means ${c("x <> 4 AND x <> 9 AND x <> NULL")}, and ${c("x <> NULL")} is never true. Use NOT EXISTS, or add ${c("WHERE customer_id IS NOT NULL")} to the subquery.`,
      more: `Customers 4 and 9 have been flagged.`,
    },
    why: `<p>${c("NOT IN")} expands to a chain of ${c("<>")} comparisons joined by AND. One NULL in the list makes one comparison NULL, and TRUE AND NULL is NULL, so no row passes. ${c("IN")} doesn't have the problem (it's an OR chain), which is what makes NOT IN so sneaky.</p>
<p>${c("NOT EXISTS")} asks "is there a matching row?", which is never NULL. Prefer it (or LEFT ANTI JOIN in Spark) whenever the subquery's column can be NULL.</p>`,
    wrong: [
      `SELECT customer_id, name FROM customers WHERE customer_id NOT IN (SELECT customer_id FROM fraud_flags)`,
    ],
  },
  {
    id: "n3", topic: "nulls", title: "AVG skips NULLs",
    task: `Average monthly fee per account type, where an account with no fee plan (${c("monthly_fee")} is NULL) counts as a $0 fee. Return ${c("type")} and ${c("avg_fee")}.`,
    tables: ["accounts"],
    answer: `SELECT type, AVG(COALESCE(monthly_fee, 0)) AS avg_fee
FROM accounts
GROUP BY type`,
    hint: `What is AVG's denominator when some fees are NULL?`,
    traps: {
      values: `AVG skips NULLs, so it averages only accounts that have a fee plan: too high, or NULL when nobody in the group has one (cards). ${c("COALESCE(monthly_fee, 0)")} counts them as $0.`,
    },
    why: `<p>Every aggregate except ${c("COUNT(*)")} ignores NULLs. ${c("AVG(x)")} is really ${c("SUM(x) / COUNT(x)")}, so NULLs leave both the top and the bottom. Sometimes that's right (an unknown score shouldn't count as 0); here the business rule says "no plan = $0", so you have to say so with COALESCE.</p>
<p>Ask "what does NULL mean in this column?" before averaging it.</p>`,
    wrong: [
      `SELECT type, AVG(monthly_fee) AS avg_fee FROM accounts GROUP BY type`,
    ],
  },
  {
    id: "n4", topic: "nulls", title: "Conditional sums (FILTER)",
    task: `For every account, return ${c("account_id")}, ${c("deposits")} (total credits), ${c("spending")} (total debits) and ${c("big_purchases")} (how many debits were over $500). Accounts with none of something show 0, not NULL.`,
    tables: ["accounts", "transactions"],
    answer: `SELECT
  a.account_id,
  COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'credit'), 0) AS deposits,
  COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'debit'), 0) AS spending,
  COUNT(*) FILTER (WHERE t.direction = 'debit' AND t.amount > 500) AS big_purchases
FROM accounts a
LEFT JOIN transactions t ON t.account_id = a.account_id
GROUP BY a.account_id`,
    hint: `One pass over the table with three filtered aggregates. FILTER (WHERE …) and SUM(CASE WHEN … END) both work.`,
    traps: {
      values: `SUM over zero rows is NULL, not 0. Savings accounts have no debits and most cards have no credits: wrap the sums in ${c("COALESCE(…, 0)")}.`,
      fewer: `Every account belongs in the result, including 116, which has no transactions. Start from accounts and LEFT JOIN.`,
    },
    why: `<p>${c("SUM(x) FILTER (WHERE cond)")} is shorthand for ${c("SUM(CASE WHEN cond THEN x END)")}. Both scan the table once, which beats three separate queries. Spark SQL supports FILTER too.</p>
<p>The trap is that SUM of nothing is NULL. COUNT is the exception: COUNT of nothing is 0.</p>`,
    wrong: [
      `SELECT a.account_id, SUM(t.amount) FILTER (WHERE t.direction='credit') AS deposits, SUM(t.amount) FILTER (WHERE t.direction='debit') AS spending, COUNT(*) FILTER (WHERE t.direction='debit' AND t.amount > 500) AS big_purchases FROM accounts a LEFT JOIN transactions t ON t.account_id = a.account_id GROUP BY 1`,
    ],
  },
  {
    id: "n5", topic: "nulls", title: "HAVING, then count",
    task: `How many customers spent more than <strong>$5,000</strong> in total (debits across all their accounts, January–June 2026)? Return a single number, ${c("high_spenders")}.`,
    tables: ["accounts", "transactions"],
    answer: `SELECT COUNT(*) AS high_spenders
FROM (
  SELECT a.customer_id
  FROM accounts a
  JOIN transactions t ON t.account_id = a.account_id
  WHERE t.direction = 'debit'
  GROUP BY a.customer_id
  HAVING SUM(t.amount) > 5000
)`,
    hint: `WHERE filters rows before grouping; HAVING filters groups after. Then you still need to count the groups.`,
    traps: {
      more: `HAVING keeps the groups that pass, but each group is still its own row. Wrap it: ${c("SELECT COUNT(*) FROM (…)")}.`,
      values: `Only debits count, and the total is per customer across all of their accounts.`,
    },
    why: `<p>SQL runs in this order: FROM/JOIN → WHERE (rows) → GROUP BY → HAVING (groups) → SELECT → ORDER BY. So WHERE can't see ${c("SUM(…)")} yet, and HAVING is the first place a total exists.</p>
<p>"How many groups pass?" needs a second level of aggregation: group, filter the groups, then count them.</p>`,
    wrong: [
      `SELECT a.customer_id FROM accounts a JOIN transactions t USING (account_id) WHERE t.direction='debit' GROUP BY 1 HAVING SUM(t.amount) > 5000`,
      `SELECT COUNT(*) AS high_spenders FROM (SELECT a.customer_id FROM accounts a JOIN transactions t USING (account_id) GROUP BY 1 HAVING SUM(t.amount) > 5000)`,
    ],
  },

  // ------------------------------------------------------------ cost
  {
    id: "c1", topic: "cost", type: "choice", title: "Broadcast or shuffle?",
    task: `${c("fact_txns")} has 50 million rows; ${c("branches")} has 40. Both plans return the same totals per region. Which finishes first on a Spark cluster, and why?`,
    plans: [
      { label: "Plan A", text: `HashAggregate(region)
└ SortMergeJoin(branch_id)
   ├ Sort ← Exchange hashpartitioning(branch_id, 200)
   │        ← Scan fact_txns (50,000,000 rows)
   └ Sort ← Exchange hashpartitioning(branch_id, 200)
            ← Scan branches (40 rows)` },
      { label: "Plan B", text: `HashAggregate(region)
└ BroadcastHashJoin(branch_id)
   ├ Scan fact_txns (50,000,000 rows)   no exchange
   └ BroadcastExchange
      ← Scan branches (40 rows)` },
    ],
    options: [
      "Plan A: sort-merge joins are built for big tables",
      "Plan B: the 50M-row table never moves between machines; only the 40-row table is copied to every executor",
      "Plan B: broadcasting skips the GROUP BY",
      "Same speed: Spark runs both plans the same way",
    ],
    correct: 1,
    hint: `Each "Exchange" means sending rows across the network. Count how many rows each plan sends.`,
    why: `<p>A <strong>shuffle</strong> (Exchange hashpartitioning) sends every row over the network so rows with the same key land on the same machine. Plan A shuffles all 50 million fact rows, then sorts them. Cost grows with the big table.</p>
<p>A <strong>broadcast</strong> join copies the small table to every executor once and joins in place, so the big table is only read where it already sits. Spark picks it automatically when one side is under ${c("spark.sql.autoBroadcastJoinThreshold")} (10 MB by default), and adaptive query execution can switch to it at runtime. ${c("/*+ BROADCAST(b) */")} forces it.</p>`,
  },
  {
    id: "c2", topic: "cost", type: "choice", title: "Filter before or after the join?",
    task: `Query A filters ${c("fact_txns")} to June inside a subquery, then joins to ${c("accounts")}. Query B joins first and filters to June in the outer WHERE. Which is faster?`,
    plans: [
      { label: "Plan for A", text: `Join(account_id)
├ Filter(txn_date >= 2026-06-01 AND txn_date < 2026-07-01)
│  ← Scan fact_txns  PushedFilters: [txn_date >= …, txn_date < …]
└ Scan accounts` },
      { label: "Plan for B", text: `Join(account_id)
├ Filter(txn_date >= 2026-06-01 AND txn_date < 2026-07-01)
│  ← Scan fact_txns  PushedFilters: [txn_date >= …, txn_date < …]
└ Scan accounts` },
    ],
    options: [
      "A: filtering first always means less work",
      "B: joining first lets Spark use the account index",
      "The same: the optimizer pushes B's WHERE below the join, so both plans are identical",
      "B: the outer WHERE runs in parallel",
    ],
    correct: 2,
    hint: `Compare the two plans line by line.`,
    why: `<p>You write SQL; the optimizer (Catalyst in Spark) decides the order. <strong>Predicate pushdown</strong> moves a filter as close to the scan as it can, even into the file reader (PushedFilters), so both queries read only June. Write whichever is clearer.</p>
<p>Where order <em>does</em> change results is outer joins: a WHERE on the optional side of a LEFT JOIN can't be pushed into the join without changing the answer. That's the LEFT JOIN drill in the joins topic. When a query is slow, read the plan before rewriting the SQL.</p>`,
  },
  {
    id: "c3", topic: "cost", type: "choice", title: "Partition pruning",
    task: `${c("fact_txns")} is a Parquet table partitioned by ${c("txn_month")} (folders like ${c("txn_month=2026-06")}), with 36 months of data. Which query reads less?`,
    plans: [
      { label: "A: WHERE txn_date BETWEEN '2026-06-01' AND '2026-06-30'", text: `Scan parquet fact_txns
  PartitionFilters: []
  DataFilters: [txn_date >= 2026-06-01, txn_date <= 2026-06-30]
  partitions read: 36 of 36` },
      { label: "B: WHERE txn_month = '2026-06'", text: `Scan parquet fact_txns
  PartitionFilters: [txn_month = 2026-06]
  partitions read: 1 of 36` },
    ],
    options: [
      "A: a date range is more precise than a month string",
      "B: a filter on the partition column skips whole folders before any file is opened",
      "Same: Spark reads the same files either way",
      "A: BETWEEN is optimized for partitions",
    ],
    correct: 1,
    hint: `Look at PartitionFilters in each plan.`,
    why: `<p><strong>Partition pruning</strong> only happens when the filter is on the partition column itself. Spark checks it against the folder names and never opens the other 35 months. A filter on txn_date is a data filter: Spark has to open every partition's files, and at best skips row groups using their min/max stats.</p>
<p>Habit: filter on the partition column (or both). On Delta, a partition column defined as a <em>generated column</em> from txn_date lets Spark derive the partition filter for you.</p>`,
  },
  {
    id: "c4", topic: "cost", type: "choice", title: "Why COUNT(DISTINCT) is slow",
    task: `A dashboard runs ${c("SELECT txn_date, COUNT(DISTINCT customer_id) FROM fact_txns GROUP BY txn_date")}. It's about 6× slower than the same query with ${c("COUNT(*)")}. Why, and what's the cheap fix if ±2% is close enough?`,
    plans: [
      { label: "COUNT(*)", text: `HashAggregate(txn_date, count)
└ Exchange hashpartitioning(txn_date)
   └ HashAggregate(txn_date, partial_count)   ← one small row per date per task
      └ Scan fact_txns` },
      { label: "COUNT(DISTINCT customer_id)", text: `HashAggregate(txn_date, count(customer_id))
└ Exchange hashpartitioning(txn_date)
   └ HashAggregate(txn_date, customer_id)
      └ Exchange hashpartitioning(txn_date, customer_id)   ← every distinct pair moves
         └ HashAggregate(txn_date, customer_id)
            └ Scan fact_txns` },
    ],
    options: [
      "It sorts the whole table first",
      "Every distinct (date, customer) pair has to be kept and shuffled to be de-duplicated; approx_count_distinct uses a small fixed-size sketch instead",
      "DISTINCT turns off partition pruning",
      "Spark computes COUNT(DISTINCT) on the driver",
    ],
    correct: 1,
    hint: `COUNT(*) can be added up in pieces. Can a distinct count?`,
    why: `<p>${c("COUNT(*)")} combines easily: each task counts its rows, then the partial counts are added. A distinct count can't be added up (customer 7 may appear in many tasks), so Spark keeps every distinct (date, customer) pair, shuffles them so duplicates meet, de-duplicates, then counts: an extra shuffle sized by the number of distinct pairs.</p>
<p>${c("approx_count_distinct(customer_id)")} uses HyperLogLog, a sketch of a few KB per group that <em>can</em> be combined, typically within a couple of percent. Fine for dashboards; use the exact count for anything that reconciles.</p>`,
  },
  {
    id: "c5", topic: "cost", type: "choice", title: "One slow task (skew)",
    task: `A job joins ${c("fact_txns")} to ${c("merchant_details")} on ${c("merchant")}. 199 of 200 tasks finish in 20 seconds; one runs for 30 minutes. 40% of all rows have ${c("merchant = 'Shopwell'")}. What's happening, and what helps?`,
    plans: [
      { label: "Spark UI, join stage", text: `Tasks: 200   Median duration: 20 s   Max: 30 min
Shuffle read per task  median: 48 MB   max: 19.6 GB
SortMergeJoin(merchant)
├ Exchange hashpartitioning(merchant, 200)
└ Exchange hashpartitioning(merchant, 200)` },
    ],
    options: [
      "The cluster needs more executors",
      "Data skew: every Shopwell row hashes to the same partition, so one task gets 40% of the data. Adaptive skew-join handling splits that partition; salting the key or broadcasting the small side also helps",
      "One of the input files is corrupt",
      "Raise spark.sql.shuffle.partitions to 2000 and it goes away",
    ],
    correct: 1,
    hint: `Compare the median and max shuffle read per task.`,
    why: `<p>Hash partitioning sends every row with the same key to the same task. When one key holds 40% of the rows, that task does 40% of the work while the others sit idle, and more executors or more partitions don't help: one key still goes to one partition.</p>
<p>Fixes: adaptive query execution's skew join (${c("spark.sql.adaptive.skewJoin.enabled")}, on by default in recent Spark and Databricks) splits an oversized partition; broadcasting merchant_details avoids the shuffle entirely if it's small; <strong>salting</strong> adds a random suffix to the hot key on one side and replicates the other side, spreading the hot key over several tasks.</p>`,
  },
];
