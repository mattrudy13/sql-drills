# Query Workbook

SQL drills on a made-up bank database, built around the mistakes that are easy to make at work:

- **Window functions:** latest row per key, running totals (and the RANGE frame trap), RANK vs DENSE_RANK, LAG,
  moving averages over a gap.
- **Joins & duplicates:** fan-out, the LEFT JOIN that turns INNER, anti-joins, as-of joins to SCD2 history,
  deduping a double load.
- **Aggregation & NULLs:** COUNT(*) vs COUNT(col), NOT IN with a NULL, AVG skipping NULLs, FILTER, HAVING.
- **Query cost (Spark):** broadcast vs shuffle, predicate pushdown, partition pruning, COUNT(DISTINCT), skew,
  which join Spark picks, and finding a hot key before it bites. Several link to a matching race in
  [Engine Room](https://mattrudy13.github.io/engine-room/).

Queries run in your browser on [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview), checked against an answer
with a row-by-row diff when they don't match, followed by a short "why it works" note.

Open it: https://mattrudy13.github.io/sql-drills/

Plain HTML, CSS and JavaScript, no build step. `npm install && npm test` runs every answer on the same DuckDB build
and proves each drill's common wrong answers fail.
