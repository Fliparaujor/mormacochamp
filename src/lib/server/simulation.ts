import crypto from "node:crypto";
import type { Db } from "./db";
import type { TournamentRow } from "./rows";
import { logEvent, newToken } from "./tournament";
import { DEFAULT_RULES_MD } from "@/lib/rules";

const NAMES = [
  "Ana Pikachu",
  "Bruno Charizard",
  "Carla Gardevoir",
  "Diego Dragapult",
  "Elaine Lugia",
  "Fábio Gholdengo",
  "Gabi Miraidon",
  "Heitor Raging Bolt",
  "Iara Terapagos",
  "João Lost Box",
  "Karen Regidrago",
  "Lucas Archaludon",
  "Marina Snorlax",
  "Nando Roaring Moon",
  "Olga Iron Thorns",
  "Pedro Palkia",
];

const SAMPLE_DECK = `Pokémon: 12
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
1 Fezandipiti ex SFA 38

Trainer: 36
4 Arven SVI 166
4 Iono PAL 185
4 Ultra Ball SVI 196
4 Rare Candy SVI 191
4 Buddy-Buddy Poffin TEF 144
4 Night Stretcher SFA 61
4 Counter Catcher PAR 160
4 Boss's Orders PAL 172
4 Nest Ball SVI 181

Energy: 12
6 Basic Fire Energy SVE 2
6 Basic Psychic Energy SVE 5

Total Cards: 60`;

export interface SimulationOptions {
  players?: number;
  now?: Date;
  checkinSeconds?: number;
  roundMinutes?: number;
  delaySeconds?: number;
}

/**
 * Cria um torneio de simulação marcado `is_simulation`, com jogadores fictícios já pagos.
 * O check-in abre agora e fecha em `checkinSeconds`; os bots fazem check-in e reportam
 * resultados aleatórios sozinhos. Tudo segue pelo tick automático.
 */
export async function createSimulation(db: Db, opts: SimulationOptions = {}): Promise<TournamentRow> {
  const now = opts.now ?? new Date();
  const n = Math.min(opts.players ?? 12, NAMES.length);
  const suffix = crypto.randomBytes(3).toString("hex");
  return db.tx(async (tx) => {
    const [t] = await tx.query<TournamentRow>(
      `insert into tournaments (slug, name, starts_at, status, checkin_opens_at, checkin_closes_at,
         round_minutes, auto_next_round_delay_seconds, min_players, max_players, entry_fee_cents, pix_key,
         is_simulation, rules_md, room_required_topcut)
       values ($1,$2,$3,'registration',$4,$5,$6,$7,$8,32,1500,'simulacao@mormaco',true,$9,false) returning *`,
      [
        `simulacao-${suffix}`,
        `Simulação ${suffix.toUpperCase()}`,
        new Date(now.getTime() + (opts.checkinSeconds ?? 60) * 1000),
        now,
        new Date(now.getTime() + (opts.checkinSeconds ?? 60) * 1000),
        opts.roundMinutes ?? 2,
        opts.delaySeconds ?? 10,
        Math.min(8, n),
        DEFAULT_RULES_MD,
      ],
    );
    for (let i = 0; i < n; i++) {
      const name = NAMES[i];
      const [p] = await tx.query<{ id: string }>(
        `insert into players (tournament_id, token, name, tcglive_name, whatsapp, payment_status, payment_ref,
           decklist_text, is_bot)
         values ($1,$2,$3,$4,'+55 85 90000-0000','paid','simulacao',$5,true) returning id`,
        [t.id, newToken(), name, name.replace(/\s+/g, "").slice(0, 14) + (i + 1), SAMPLE_DECK],
      );
      await logEvent(tx, t.id, "registration", { player: name, player_id: p.id });
      await logEvent(tx, t.id, "payment_confirmed", { player: name, player_id: p.id, provider: "simulação", by: "sistema" });
    }
    await logEvent(tx, t.id, "simulation_started", { players: n });
    return t;
  });
}
