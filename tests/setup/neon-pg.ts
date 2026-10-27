import { Pool } from "pg";

/**
 * Minimal stand-in for `neon()` from @neondatabase/serverless, backed by a regular
 * Postgres connection (node-postgres). It supports the two call styles the app uses:
 *   sql`SELECT ... ${value}`         -> rows[]
 *   sql.query("SELECT ... $1", [v])  -> rows[]
 * node-postgres uses the same default type parsers as the Neon driver (date and
 * timestamptz -> Date, numeric -> string, time -> string, arrays -> JS arrays).
 */
export function makeNeonShim(url: string) {
  const pool = new Pool({ connectionString: url, max: 4 });

  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => {
      text += `$${i + 1}` + strings[i + 1];
    });
    return pool.query(text, values as unknown[]).then((r) => r.rows);
  };
  fn.query = (text: string, params: unknown[] = []) => pool.query(text, params).then((r) => r.rows);
  fn.end = () => pool.end();
  return fn;
}
