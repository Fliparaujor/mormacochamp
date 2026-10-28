import type { Db } from "./db";
import { tickAll, tickTournament, type TickOutcome } from "./tournament";
import { refundAll } from "./payments";

const lastTick = new Map<string, number>();
const MIN_INTERVAL_MS = 3000;

async function afterTick(db: Db, outs: TickOutcome[]) {
  for (const o of outs) if (o.refundPlayerIds.length) await refundAll(db, o.tournamentId, o.refundPlayerIds);
}

/** Tick de um torneio (disparado pelas páginas abertas). Com throttle por instância. */
export async function runTournamentTick(db: Db, tournamentId: string, force = false): Promise<TickOutcome | null> {
  const last = lastTick.get(tournamentId) ?? 0;
  if (!force && Date.now() - last < MIN_INTERVAL_MS) return null;
  lastTick.set(tournamentId, Date.now());
  const out = await tickTournament(db, tournamentId, new Date());
  await afterTick(db, [out]);
  return out;
}

/** Tick de todos os torneios ativos (cron a cada minuto). */
export async function runAllTicks(db: Db): Promise<TickOutcome[]> {
  const outs = await tickAll(db, new Date());
  await afterTick(db, outs);
  return outs;
}
