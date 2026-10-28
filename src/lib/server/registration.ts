import crypto from "node:crypto";
import type { Db } from "./db";
import type { PlayerRow, TournamentRow } from "./rows";
import { getTournament, lockTournament, logEvent, newToken, playerByToken, UserError } from "./tournament";
import { parseDecklist } from "@/lib/engine/decklist";

export interface RegistrationInput {
  tournamentId: string;
  name: string;
  tcgliveName: string;
  whatsapp: string;
  email?: string | null;
  decklist?: string | null;
  ip?: string | null;
}

const RATE_WINDOW_MIN = 10;
const RATE_MAX = 5;

export function registrationOpen(t: TournamentRow): boolean {
  return t.status === "registration" || t.status === "checkin";
}

export async function registerPlayer(db: Db, input: RegistrationInput): Promise<PlayerRow> {
  return db.tx(async (tx) => {
    const t = await getTournament(tx, input.tournamentId);
    if (!t) throw new UserError("Torneio não encontrado.");
    await lockTournament(tx, t.id);
    if (!registrationOpen(t)) throw new UserError("As inscrições estão fechadas.");

    const ipHash = input.ip ? crypto.createHash("sha256").update(`${t.id}:${input.ip}`).digest("hex").slice(0, 32) : null;
    if (ipHash) {
      const [{ n }] = await tx.query<{ n: number }>(
        `select count(*)::int as n from players where tournament_id = $1 and reg_ip_hash = $2
         and created_at > now() - ($3 || ' minutes')::interval`,
        [t.id, ipHash, String(RATE_WINDOW_MIN)],
      );
      if (n >= RATE_MAX) throw new UserError("Muitas inscrições seguidas daqui. Espera uns minutos e tenta de novo.");
    }

    const [{ n: paid }] = await tx.query<{ n: number }>(
      "select count(*)::int as n from players where tournament_id = $1 and payment_status = 'paid'",
      [t.id],
    );
    if (paid >= t.max_players) throw new UserError("O torneio lotou.");

    const dupe = await tx.query(
      "select 1 from players where tournament_id = $1 and lower(tcglive_name) = lower($2) and payment_status <> 'refunded'",
      [t.id, input.tcgliveName],
    );
    if (dupe.length) throw new UserError("Esse nome do TCG Live já está inscrito. Se for você, usa o seu link pessoal.");

    const deck = input.decklist?.trim() || null;
    const parsed = deck ? parseDecklist(deck) : null;
    const [p] = await tx.query<PlayerRow>(
      `insert into players (tournament_id, token, name, tcglive_name, whatsapp, email, decklist_text, decklist_json, reg_ip_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        t.id,
        newToken(),
        input.name.trim(),
        input.tcgliveName.trim(),
        input.whatsapp.trim(),
        input.email?.trim() || null,
        deck,
        parsed ? JSON.stringify(parsed) : null,
        ipHash,
      ],
    );
    await logEvent(tx, t.id, "registration", { player: p.name, player_id: p.id });
    return p;
  });
}

export async function updateDecklist(db: Db, token: string, text: string, actor: "player" | "admin" = "player") {
  return db.tx(async (tx) => {
    const p = await playerByToken(tx, token);
    if (p.decklist_locked && actor === "player") throw new UserError("Sua lista travou no check-in. Fale com o juiz.");
    await saveDecklist(tx, p, text, actor);
  });
}

export async function saveDecklist(db: Db, p: PlayerRow, text: string, actor: "player" | "admin") {
  const deck = text.trim() || null;
  const parsed = deck ? parseDecklist(deck) : null;
  await db.query("update players set decklist_text = $2, decklist_json = $3 where id = $1", [
    p.id,
    deck,
    parsed ? JSON.stringify(parsed) : null,
  ]);
  await logEvent(db, p.tournament_id, "decklist_updated", { player: p.name, player_id: p.id, cards: parsed?.total ?? 0, by: actor });
}
