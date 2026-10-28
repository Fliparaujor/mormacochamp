// Aplica schema.sql no banco de DATABASE_URL. Uso: DATABASE_URL=... npm run db:setup
import fs from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();
await client.query(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("Schema aplicado.");
