// Seed de simulação: cria um torneio is_simulation com 12 jogadores fictícios já pagos.
// O check-in abre agora e fecha em 1 minuto; o resto roda sozinho pelo tick
// (cron, ou deixando a página do torneio/admin aberta). Uso: DATABASE_URL=... npm run db:seed
import crypto from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL");
  process.exit(1);
}
const names = ["Ana Pikachu", "Bruno Charizard", "Carla Gardevoir", "Diego Dragapult", "Elaine Lugia", "Fábio Gholdengo", "Gabi Miraidon", "Heitor Raging Bolt", "Iara Terapagos", "João Lost Box", "Karen Regidrago", "Lucas Archaludon"];
const deck = "Pokémon: 12\n4 Dreepy TWM 128\n4 Drakloak TWM 129\n3 Dragapult ex TWM 130\n1 Fezandipiti ex SFA 38\nTrainer: 36\n36 Ultra Ball SVI 196\nEnergy: 12\n12 Basic Fire Energy SVE 2";
const token = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(32), (b) => a[b % a.length]).join("");
};
const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await c.connect();
const suffix = crypto.randomBytes(3).toString("hex");
const { rows: [t] } = await c.query(
  `insert into tournaments (slug, name, starts_at, status, checkin_opens_at, checkin_closes_at, round_minutes,
     auto_next_round_delay_seconds, is_simulation, pix_key, room_required_topcut)
   values ($1, $2, now() + interval '1 minute', 'registration', now(), now() + interval '1 minute', 2, 10, true, 'simulacao', false)
   returning id, slug`,
  [`simulacao-${suffix}`, `Simulação ${suffix.toUpperCase()}`],
);
for (const [i, n] of names.entries()) {
  const { rows: [p] } = await c.query(
    `insert into players (tournament_id, token, name, tcglive_name, whatsapp, payment_status, payment_ref, decklist_text, is_bot)
     values ($1, $2, $3, $4, '+55 85 90000-0000', 'paid', 'simulacao', $5, true) returning id`,
    [t.id, token(), n, n.replace(/\s+/g, "").slice(0, 14) + (i + 1), deck],
  );
  await c.query("insert into events (tournament_id, type, payload) values ($1, 'registration', $2), ($1, 'payment_confirmed', $3)", [
    t.id,
    { player: n, player_id: p.id },
    { player: n, player_id: p.id, provider: "simulação", by: "sistema" },
  ]);
}
await c.query("insert into events (tournament_id, type, payload) values ($1, 'simulation_started', $2)", [t.id, { players: names.length }]);
await c.end();
console.log(`Simulação criada: /t/${t.slug} (admin: /admin/t/${t.id})`);
