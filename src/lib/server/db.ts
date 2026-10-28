import { Pool, types } from "pg";

// bigint (ids de events) como number
types.setTypeParser(20, (v) => parseInt(v, 10));

export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

const g = globalThis as unknown as { __arenaDb?: Db; __arenaPool?: Pool };

export function setDb(db: Db) {
  g.__arenaDb = db;
}

export function getDb(): Db {
  if (g.__arenaDb) return g.__arenaDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada. Veja o README.");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const pool =
    g.__arenaPool ??
    new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      idleTimeoutMillis: 10_000,
    });
  g.__arenaPool = pool;
  const db: Db = {
    async query(text, params) {
      const r = await pool.query(text, params as any[]);
      return r.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const inner: Db = {
          async query(text, params) {
            const r = await client.query(text, params as any[]);
            return r.rows;
          },
          tx: (f) => f(inner), // transação aninhada reaproveita a atual
        };
        const out = await fn(inner);
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
  g.__arenaDb = db;
  return db;
}
