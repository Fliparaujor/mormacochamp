import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/server/db";

/** Banco Postgres em memória (PGlite) com o schema.sql aplicado. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const pg = new PGlite();
  const schema = fs.readFileSync(path.resolve(__dirname, "../../schema.sql"), "utf8");
  await pg.exec(schema);
  const wrap = (q: { query: PGlite["query"] }): Db => ({
    async query(text, params) {
      const r = await q.query(text, params as any[]);
      return r.rows as any[];
    },
    tx: async (fn) => fn(wrap(q)),
  });
  const db: Db = {
    query: wrap(pg).query,
    tx: (fn) => pg.transaction((tx) => fn(wrap(tx as any))) as any,
  };
  return { db, close: () => pg.close() };
}
