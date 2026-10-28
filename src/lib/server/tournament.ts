import crypto from "node:crypto";
import type { Db } from "./db";
import type { EventRow, MatchRow, PlayerRow, RoundRow, TournamentRow } from "./rows";
import { computeStandings, tiesBrokenByLottery } from "@/lib/engine/standings";
import { pairSwissRound } from "@/lib/engine/pairing";
import { firstCutPairings, nextCutPairings, finalPlacements, cutRoundLabel } from "@/lib/engine/topcut";
import { resolveStructure, prizeBandFor, DEFAULT_PRIZE_TABLE } from "@/lib/engine/structure";
import { canReport, decideMatch, isResolved } from "@/lib/engine/results";
import { shuffle } from "@/lib/engine/rng";
import type { EngineMatch, EnginePlayer, MatchResult, Pairing, Report, StandingRow } from "@/lib/engine/types";

export type Actor = "auto" | "admin" | "player" | "sistema";

export class UserError extends Error {}

// ───────────────────────── leitura ─────────────────────────

export async function getTournament(db: Db, id: string): Promise<TournamentRow | null> {
  const [t] = await db.query<TournamentRow>("select * from tournaments where id = $1", [id]);
  return t ?? null;
}

export async function getTournamentBySlug(db: Db, slug: string): Promise<TournamentRow | null> {
  const [t] = await db.query<TournamentRow>("select * from tournaments where slug = $1", [slug]);
  return t ?? null;
}

export interface TournamentState {
  t: TournamentRow;
  players: PlayerRow[];
  rounds: RoundRow[];
  matches: MatchRow[];
}

export async function loadState(db: Db, tournamentId: string): Promise<TournamentState> {
  const t = await getTournament(db, tournamentId);
  if (!t) throw new UserError("Torneio não encontrado.");
  const players = await db.query<PlayerRow>(
    "select * from players where tournament_id = $1 order by created_at, id",
    [tournamentId],
  );
  const rounds = await db.query<RoundRow>("select * from rounds where tournament_id = $1 order by number", [tournamentId]);
  const matches = await db.query<MatchRow>(
    `select m.* from matches m join rounds r on r.id = m.round_id
     where r.tournament_id = $1 order by r.number, m.table_number`,
    [tournamentId],
  );
  return { t, players, rounds, matches };
}

export function participants(players: PlayerRow[]): PlayerRow[] {
  return players.filter((p) => p.payment_status === "paid" && p.checked_in);
}

export function enginePlayers(players: PlayerRow[]): EnginePlayer[] {
  return participants(players).map((p) => ({ id: p.id, name: p.name, seed: p.seed ?? 9999, dropped: p.dropped }));
}

export function engineMatches(state: Pick<TournamentState, "rounds" | "matches">): EngineMatch[] {
  const byId = new Map(state.rounds.map((r) => [r.id, r]));
  return state.matches
    .filter((m) => m.p1_id)
    .map((m) => {
      const r = byId.get(m.round_id)!;
      return {
        roundNumber: r.number,
        stage: r.stage,
        tableNumber: m.table_number,
        p1: m.p1_id!,
        p2: m.p2_id,
        result: m.disputed ? null : m.result,
      };
    });
}

export function swissStandings(state: TournamentState): StandingRow[] {
  return computeStandings(enginePlayers(state.players), engineMatches(state));
}

export function prizeTable(t: TournamentRow) {
  return t.prize_table && Array.isArray(t.prize_table) && t.prize_table.length ? t.prize_table : DEFAULT_PRIZE_TABLE;
}

function nameMap(players: PlayerRow[]) {
  return new Map(players.map((p) => [p.id, p.name]));
}

export function roundLabel(round: RoundRow, matchesInRound: number): string {
  if (round.stage === "swiss") return `Rodada ${round.number}`;
  return cutRoundLabel(matchesInRound * 2);
}

// ───────────────────────── eventos e lock ─────────────────────────

export async function logEvent(db: Db, tournamentId: string, type: string, payload: Record<string, unknown> = {}) {
  await db.query("insert into events (tournament_id, type, payload) values ($1, $2, $3)", [
    tournamentId,
    type,
    JSON.stringify(payload),
  ]);
}

/** Lock exclusivo por torneio dentro da transação. Nunca gera duas rodadas ao mesmo tempo. */
export async function lockTournament(db: Db, tournamentId: string) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`arena:${tournamentId}`]);
}

export async function listEvents(db: Db, tournamentId: string, limit = 50): Promise<EventRow[]> {
  return db.query<EventRow>("select * from events where tournament_id = $1 order by id desc limit $2", [
    tournamentId,
    limit,
  ]);
}

// ───────────────────────── tokens ─────────────────────────

export function newToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(32);
  let out = "";
  for (let i = 0; i < 32; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function jitsiRoom(slug: string, round: number, table: number) {
  const hash = crypto.randomBytes(4).toString("hex");
  return `arena-mormaco-${slug}-r${round}-m${table}-${hash}`.replace(/[^a-zA-Z0-9-]/g, "");
}

// ───────────────────────── check-in ─────────────────────────

export async function openCheckin(db: Db, t: TournamentRow, actor: Actor) {
  if (!["draft", "registration"].includes(t.status)) throw new UserError("O check-in só abre a partir das inscrições.");
  await db.query("update tournaments set status = 'checkin' where id = $1", [t.id]);
  await logEvent(db, t.id, "checkin_opened", { by: actor });
}

export interface CloseCheckinOutcome {
  cancelled: boolean;
  refundPlayerIds: string[];
}

export async function closeCheckin(db: Db, t: TournamentRow, now: Date, actor: Actor): Promise<CloseCheckinOutcome> {
  if (t.status !== "checkin" && t.status !== "registration") throw new UserError("O check-in não está aberto.");
  const players = await db.query<PlayerRow>("select * from players where tournament_id = $1", [t.id]);
  const noShows = players.filter((p) => p.payment_status === "paid" && !p.checked_in && !p.dropped);
  for (const p of noShows) {
    await db.query("update players set dropped = true, drop_reason = 'sem check-in' where id = $1", [p.id]);
    await logEvent(db, t.id, "drop", { player: p.name, player_id: p.id, reason: "sem check-in", by: actor });
  }
  const ins = participants(players).filter((p) => !p.dropped);
  await db.query("update players set decklist_locked = true where id = any($1::uuid[])", [ins.map((p) => p.id)]);
  await logEvent(db, t.id, "checkin_closed", { count: ins.length, no_shows: noShows.length, by: actor });

  if (ins.length < t.min_players) {
    await db.query("update tournaments set status = 'cancelled', next_round_at = null where id = $1", [t.id]);
    await logEvent(db, t.id, "cancelled", { reason: "quorum", count: ins.length, min: t.min_players, by: actor });
    const paid = players.filter((p) => p.payment_status === "paid");
    return { cancelled: true, refundPlayerIds: paid.map((p) => p.id) };
  }

  // Sorteio das seeds: ordem da rodada 1 e desempate final.
  const order = shuffle(ins);
  for (let i = 0; i < order.length; i++) {
    await db.query("update players set seed = $2 where id = $1", [order[i].id, i + 1]);
  }
  await logEvent(db, t.id, "seeds_drawn", { order: order.map((p) => p.name) });

  const structure = resolveStructure(ins.length, { swissRounds: t.swiss_rounds, topCut: t.topcut_size });
  await db.query(
    "update tournaments set status = 'swiss', swiss_rounds = $2, topcut_size = $3, next_round_at = $4 where id = $1",
    [t.id, structure.swissRounds, structure.topCut, now],
  );
  await logEvent(db, t.id, "structure", { players: ins.length, swiss_rounds: structure.swissRounds, top_cut: structure.topCut });
  return { cancelled: false, refundPlayerIds: [] };
}

export async function playerCheckin(db: Db, token: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await playerByToken(tx, token);
    const t = (await getTournament(tx, p.tournament_id))!;
    await lockTournament(tx, t.id);
    if (t.status !== "checkin") throw new UserError("O check-in não está aberto agora.");
    if (p.payment_status !== "paid") throw new UserError("Seu pagamento ainda não foi confirmado.");
    if (p.dropped) throw new UserError("Sua inscrição está fora do torneio.");
    if (p.checked_in) return;
    if (!p.decklist_text?.trim()) throw new UserError("Mande sua lista antes do check-in. Ela é obrigatória.");
    await tx.query("update players set checked_in = true, checked_in_at = $2, decklist_locked = true where id = $1", [p.id, now]);
    await logEvent(tx, t.id, "checkin", { player: p.name, player_id: p.id });
  });
}

export async function playerByToken(db: Db, token: string): Promise<PlayerRow> {
  if (!/^[A-Za-z0-9]{32}$/.test(token)) throw new UserError("Link inválido.");
  const [p] = await db.query<PlayerRow>("select * from players where token = $1", [token]);
  if (!p) throw new UserError("Link inválido.");
  return p;
}

// ───────────────────────── rodadas ─────────────────────────

type Plan =
  | { kind: "wait" }
  | { kind: "swiss"; number: number }
  | { kind: "topcut_first" }
  | { kind: "topcut_next"; pairings: Pairing[] }
  | { kind: "finish" };

export function nextRoundPlan(state: TournamentState): Plan {
  const { t, rounds } = state;
  if (rounds.some((r) => r.status !== "closed")) return { kind: "wait" };
  const swiss = rounds.filter((r) => r.stage === "swiss");
  const cut = rounds.filter((r) => r.stage === "topcut");
  const active = enginePlayers(state.players).filter((p) => !p.dropped);
  if (cut.length === 0) {
    if (swiss.length < (t.swiss_rounds ?? 0) && active.length >= 2) return { kind: "swiss", number: swiss.length + 1 };
    if ((t.topcut_size ?? 0) >= 2 && active.length >= 2) return { kind: "topcut_first" };
    return { kind: "finish" };
  }
  const last = cut[cut.length - 1];
  const em = engineMatches({ rounds: [last], matches: state.matches.filter((m) => m.round_id === last.id) });
  const next = nextCutPairings(em);
  if (next === null) return { kind: "wait" };
  if (next.length === 0) return { kind: "finish" };
  return { kind: "topcut_next", pairings: next };
}

async function createRound(
  db: Db,
  state: TournamentState,
  stage: "swiss" | "topcut",
  pairings: Pairing[],
  now: Date,
  actor: Actor,
) {
  const { t } = state;
  const number = (state.rounds.at(-1)?.number ?? 0) + 1;
  const endsAt = new Date(now.getTime() + t.round_minutes * 60_000);
  const [round] = await db.query<RoundRow>(
    `insert into rounds (tournament_id, number, stage, started_at, ends_at, status)
     values ($1, $2, $3, $4, $5, 'live') returning *`,
    [t.id, number, stage, now, endsAt],
  );
  const names = nameMap(state.players);
  for (const p of pairings) {
    const bye = p.p2 === null;
    await db.query(
      `insert into matches (round_id, table_number, p1_id, p2_id, result, result_source, confirmed_at, jitsi_room)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        round.id,
        p.tableNumber,
        p.p1,
        p.p2,
        bye ? "p1" : null,
        bye ? "bye" : null,
        bye ? now : null,
        jitsiRoom(t.slug, number, p.tableNumber),
      ],
    );
    if (bye) await logEvent(db, t.id, "bye", { round: number, player: names.get(p.p1), player_id: p.p1 });
  }
  const label = roundLabel(round, pairings.length);
  await db.query("update tournaments set next_round_at = null where id = $1", [t.id]);
  await logEvent(db, t.id, "round_opened", {
    round: number,
    stage,
    label,
    minutes: t.round_minutes,
    ends_at: endsAt.toISOString(),
    tables: pairings.map((p) => ({ table: p.tableNumber, p1: names.get(p.p1), p2: p.p2 ? names.get(p.p2) : null })),
    by: actor,
  });
  return round;
}

/** Abre a próxima rodada (suíço, primeira do corte ou próxima do corte). Idempotente: se há rodada aberta, não faz nada. */
export async function openNextRound(db: Db, tournamentId: string, now: Date, actor: Actor): Promise<RoundRow | null> {
  const state = await loadState(db, tournamentId);
  const { t } = state;
  if (t.status !== "swiss" && t.status !== "topcut") throw new UserError("O torneio não está em andamento.");
  const plan = nextRoundPlan(state);
  const names = nameMap(state.players);
  switch (plan.kind) {
    case "wait":
      return null;
    case "finish":
      await finishTournament(db, state, now, actor);
      return null;
    case "swiss": {
      const standings = swissStandings(state);
      const out = pairSwissRound({
        roundNumber: plan.number,
        standings,
        pastMatches: engineMatches(state).filter((m) => m.stage === "swiss"),
      });
      for (const [a, b] of out.forcedRematches) {
        await logEvent(db, t.id, "rematch_forced", { round: plan.number, p1: names.get(a), p2: names.get(b) });
      }
      return createRound(db, state, "swiss", out.pairings, now, actor);
    }
    case "topcut_first": {
      const standings = swissStandings(state);
      await writeStandingsCache(db, t.id, standings);
      const lottery = tiesBrokenByLottery(standings);
      for (const [a, b] of lottery) {
        await logEvent(db, t.id, "lottery_tiebreak", { above: names.get(a), below: names.get(b) });
      }
      const pairings = firstCutPairings(standings, t.topcut_size ?? 0);
      await db.query("update tournaments set status = 'topcut' where id = $1", [t.id]);
      await logEvent(db, t.id, "topcut_started", {
        size: pairings.length * 2,
        seeds: standings.filter((s) => !s.dropped).slice(0, pairings.length * 2).map((s) => names.get(s.playerId)),
      });
      return createRound(db, state, "topcut", pairings, now, actor);
    }
    case "topcut_next":
      return createRound(db, state, "topcut", plan.pairings, now, actor);
  }
}

/** Aplica as regras automáticas de confirmação/disputa às partidas de uma rodada aberta. */
async function applyDecisions(db: Db, state: TournamentState, round: RoundRow, now: Date): Promise<boolean> {
  const names = nameMap(state.players);
  let changed = false;
  for (const m of state.matches.filter((x) => x.round_id === round.id)) {
    const d = decideMatch(
      { p2: m.p2_id, p1Report: m.p1_report, p2Report: m.p2_report, result: m.result, disputed: m.disputed },
      now,
      round.ends_at,
    );
    if (d.action === "confirm") {
      await confirmMatch(db, state.t.id, round, m, d.result, d.source, now, names);
      changed = true;
    } else if (d.action === "dispute") {
      await db.query("update matches set disputed = true where id = $1", [m.id]);
      await logEvent(db, state.t.id, "dispute", {
        round: round.number,
        table: m.table_number,
        reason: d.reason,
        p1: names.get(m.p1_id!),
        p2: m.p2_id ? names.get(m.p2_id) : null,
      });
      changed = true;
    }
  }
  return changed;
}

async function confirmMatch(
  db: Db,
  tournamentId: string,
  round: RoundRow,
  m: MatchRow,
  result: MatchResult,
  source: "both" | "auto" | "bye" | "admin",
  now: Date,
  names: Map<string, string>,
  note?: string | null,
) {
  await db.query(
    `update matches set result = $2, result_source = $3, confirmed_at = $4, disputed = false,
       judge_note = coalesce($5, judge_note) where id = $1`,
    [m.id, result, source, now, note ?? null],
  );
  if (source === "bye") return;
  await logEvent(db, tournamentId, "result", {
    round: round.number,
    table: m.table_number,
    p1: names.get(m.p1_id!),
    p2: m.p2_id ? names.get(m.p2_id) : null,
    result,
    source,
    note: note ?? undefined,
  });
}

/** Se todas as partidas estão resolvidas, fecha a rodada e agenda/abre a próxima (ou encerra). */
async function maybeCloseRound(db: Db, tournamentId: string, roundId: string, now: Date, actor: Actor): Promise<boolean> {
  const state = await loadState(db, tournamentId);
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round || round.status !== "live") return false;
  const ms = state.matches.filter((m) => m.round_id === round.id);
  if (!ms.every((m) => isResolved(m))) return false;
  await db.query("update rounds set status = 'closed', closed_at = $2 where id = $1", [round.id, now]);
  round.status = "closed";
  round.closed_at = now;
  await logEvent(db, tournamentId, "round_closed", { round: round.number, label: roundLabel(round, ms.length), by: actor });
  if (round.stage === "swiss") await writeStandingsCache(db, tournamentId, swissStandings(state));

  const plan = nextRoundPlan(state);
  if (plan.kind === "finish") {
    await finishTournament(db, state, now, actor);
  } else if (plan.kind !== "wait" && state.t.auto_mode) {
    const at = new Date(now.getTime() + state.t.auto_next_round_delay_seconds * 1000);
    await db.query("update tournaments set next_round_at = $2 where id = $1", [tournamentId, at]);
    await logEvent(db, tournamentId, "next_round_scheduled", { at: at.toISOString() });
  }
  return true;
}

export async function writeStandingsCache(db: Db, tournamentId: string, rows: StandingRow[]) {
  await db.query("delete from standings_cache where tournament_id = $1", [tournamentId]);
  for (const r of rows) {
    await db.query(
      `insert into standings_cache (tournament_id, player_id, rank, match_points, wins, losses, ties, byes, owp, oowp)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tournamentId, r.playerId, r.rank, r.matchPoints, r.wins, r.losses, r.ties, r.byes, r.owp, r.oowp],
    );
  }
}

export interface Placement {
  place: number;
  playerId: string;
  name: string;
  tcglive: string;
  prizeCents: number;
}

export function computePlacements(state: TournamentState): Placement[] {
  const standings = swissStandings(state);
  const cutRounds = new Set(state.rounds.filter((r) => r.stage === "topcut").map((r) => r.id));
  const cut = engineMatches({ rounds: state.rounds, matches: state.matches.filter((m) => cutRounds.has(m.round_id)) });
  const order = finalPlacements(standings, cut);
  const n = participants(state.players).length;
  const band = prizeBandFor(n, prizeTable(state.t));
  const byId = new Map(state.players.map((p) => [p.id, p]));
  return order.map((id, i) => ({
    place: i + 1,
    playerId: id,
    name: byId.get(id)?.name ?? "?",
    tcglive: byId.get(id)?.tcglive_name ?? "",
    prizeCents: band?.prizes[i] ?? 0,
  }));
}

async function finishTournament(db: Db, state: TournamentState, now: Date, actor: Actor) {
  if (state.t.status === "finished") return;
  await db.query("update tournaments set status = 'finished', next_round_at = null where id = $1", [state.t.id]);
  if (!state.rounds.some((r) => r.stage === "topcut")) await writeStandingsCache(db, state.t.id, swissStandings(state));
  const placements = computePlacements(state);
  await logEvent(db, state.t.id, "finished", {
    champion: placements[0]?.name,
    podium: placements.filter((p) => p.prizeCents > 0 || p.place <= 4).slice(0, 8).map((p) => ({
      place: p.place,
      name: p.name,
      prize_cents: p.prizeCents,
    })),
    by: actor,
    at: now.toISOString(),
  });
}

// ───────────────────────── tick (automatismos) ─────────────────────────

export interface TickOutcome {
  tournamentId: string;
  steps: number;
  refundPlayerIds: string[];
}

/** Um passo de automação. Devolve true se mudou algo. */
async function step(db: Db, tournamentId: string, now: Date, out: TickOutcome): Promise<boolean> {
  const t = await getTournament(db, tournamentId);
  if (!t || !t.auto_mode) return false;

  if (t.status === "registration" && t.checkin_opens_at && now >= t.checkin_opens_at) {
    await openCheckin(db, t, "auto");
    return true;
  }
  if (t.status === "checkin") {
    if (t.is_simulation && (await botCheckins(db, t, now))) return true;
    if (t.checkin_closes_at && now >= t.checkin_closes_at) {
      const r = await closeCheckin(db, t, now, "auto");
      out.refundPlayerIds.push(...r.refundPlayerIds);
      return true;
    }
    return false;
  }
  if (t.status !== "swiss" && t.status !== "topcut") return false;

  const state = await loadState(db, tournamentId);
  const live = state.rounds.find((r) => r.status === "live");
  if (live) {
    let changed = false;
    if (t.is_simulation) changed = (await botReports(db, state, live, now)) || changed;
    const fresh = changed ? await loadState(db, tournamentId) : state;
    changed = (await applyDecisions(db, fresh, live, now)) || changed;
    changed = (await maybeCloseRound(db, tournamentId, live.id, now, "auto")) || changed;
    return changed;
  }
  if (t.next_round_at) {
    if (now >= t.next_round_at) {
      const r = await openNextRound(db, tournamentId, now, "auto");
      if (!r) await db.query("update tournaments set next_round_at = null where id = $1", [tournamentId]);
      return true;
    }
    return false;
  }
  // Nada agendado e nenhuma rodada aberta (ex.: auto-mode religado): agenda a próxima.
  const plan = nextRoundPlan(state);
  if (plan.kind === "finish") {
    await finishTournament(db, state, now, "auto");
    return true;
  }
  if (plan.kind === "wait") return false;
  const at = state.rounds.length === 0 ? now : new Date(now.getTime() + t.auto_next_round_delay_seconds * 1000);
  await db.query("update tournaments set next_round_at = $2 where id = $1", [tournamentId, at]);
  await logEvent(db, tournamentId, "next_round_scheduled", { at: at.toISOString() });
  return true;
}

/** Roda os automatismos de um torneio. Idempotente: rodar duas vezes seguidas não tem efeito extra. */
export async function tickTournament(db: Db, tournamentId: string, now: Date): Promise<TickOutcome> {
  const out: TickOutcome = { tournamentId, steps: 0, refundPlayerIds: [] };
  await db.tx(async (tx) => {
    await lockTournament(tx, tournamentId);
    for (let i = 0; i < 20; i++) {
      if (!(await step(tx, tournamentId, now, out))) break;
      out.steps++;
    }
  });
  return out;
}

export async function tickAll(db: Db, now: Date): Promise<TickOutcome[]> {
  const ts = await db.query<{ id: string }>(
    "select id from tournaments where auto_mode and status in ('registration','checkin','swiss','topcut')",
  );
  const outs: TickOutcome[] = [];
  for (const t of ts) outs.push(await tickTournament(db, t.id, now));
  return outs;
}

// ───────────────────────── simulação (bots) ─────────────────────────

async function botCheckins(db: Db, t: TournamentRow, now: Date): Promise<boolean> {
  const bots = await db.query<PlayerRow>(
    "select * from players where tournament_id = $1 and is_bot and payment_status = 'paid' and not checked_in and not dropped",
    [t.id],
  );
  for (const p of bots) {
    await db.query("update players set checked_in = true, checked_in_at = $2, decklist_locked = true where id = $1", [p.id, now]);
    await logEvent(db, t.id, "checkin", { player: p.name, player_id: p.id });
  }
  return bots.length > 0;
}

const BOT_REPORT_DELAY_MS = 15_000;

async function botReports(db: Db, state: TournamentState, round: RoundRow, now: Date): Promise<boolean> {
  if (!round.started_at || now.getTime() - round.started_at.getTime() < BOT_REPORT_DELAY_MS) return false;
  const bots = new Set(state.players.filter((p) => p.is_bot).map((p) => p.id));
  let changed = false;
  for (const m of state.matches.filter((x) => x.round_id === round.id)) {
    if (!m.p2_id || isResolved(m) || m.disputed || m.p1_report || m.p2_report) continue;
    if (!bots.has(m.p1_id!) || !bots.has(m.p2_id)) continue;
    const p1Wins = Math.random() < 0.5;
    await db.query("update matches set p1_report = $2, p2_report = $3, reported_at = $4 where id = $1", [
      m.id,
      p1Wins ? "win" : "loss",
      p1Wins ? "loss" : "win",
      now,
    ]);
    changed = true;
  }
  return changed;
}

// ───────────────────────── reporte do jogador ─────────────────────────

export interface PlayerMatchView {
  round: RoundRow;
  match: MatchRow;
  side: "p1" | "p2";
}

export async function findCurrentMatch(db: Db, player: PlayerRow): Promise<PlayerMatchView | null> {
  const rows = await db.query<MatchRow & { r_id: string }>(
    `select m.*, r.id as r_id from matches m join rounds r on r.id = m.round_id
     where r.tournament_id = $1 and r.status = 'live' and (m.p1_id = $2 or m.p2_id = $2)
     order by r.number desc limit 1`,
    [player.tournament_id, player.id],
  );
  if (!rows[0]) return null;
  const [round] = await db.query<RoundRow>("select * from rounds where id = $1", [rows[0].round_id]);
  const match = rows[0];
  return { round, match, side: match.p1_id === player.id ? "p1" : "p2" };
}

export async function playerReport(
  db: Db,
  input: { token: string; matchId: string; report: Report; printUrl: string },
  now: Date,
) {
  return db.tx(async (tx) => {
    const p = await playerByToken(tx, input.token);
    await lockTournament(tx, p.tournament_id);
    const [m] = await tx.query<MatchRow>("select * from matches where id = $1", [input.matchId]);
    if (!m || (m.p1_id !== p.id && m.p2_id !== p.id)) throw new UserError("Partida não encontrada.");
    const [round] = await tx.query<RoundRow>("select * from rounds where id = $1", [m.round_id]);
    if (round.status !== "live") throw new UserError("Essa rodada já fechou.");
    const st = { p2: m.p2_id, p1Report: m.p1_report, p2Report: m.p2_report, result: m.result, disputed: m.disputed };
    if (!canReport(st, now, round.ends_at)) {
      throw new UserError(m.disputed ? "Essa mesa está com o juiz." : "O reporte dessa mesa está fechado.");
    }
    const side = m.p1_id === p.id ? "p1" : "p2";
    await tx.query(
      `update matches set ${side}_report = $2, ${side}_print_url = $3, reported_at = $4 where id = $1`,
      [m.id, input.report, input.printUrl, now],
    );
    const t = (await getTournament(tx, p.tournament_id))!;
    await logEvent(tx, t.id, "report", {
      round: round.number,
      table: m.table_number,
      player: p.name,
      report: input.report,
    });
    const state = await loadState(tx, t.id);
    await applyReportedDecision(tx, state, round, m.id, now);
    await maybeCloseRound(tx, t.id, round.id, now, "player");
  });
}

/** Depois de um reporte, só as regras imediatas (dois reportes) valem; as de tempo ficam com o tick. */
async function applyReportedDecision(db: Db, state: TournamentState, round: RoundRow, matchId: string, now: Date) {
  const m = state.matches.find((x) => x.id === matchId)!;
  const d = decideMatch(
    { p2: m.p2_id, p1Report: m.p1_report, p2Report: m.p2_report, result: m.result, disputed: m.disputed },
    now,
    null, // sem relógio: reporte único não confirma aqui
  );
  const names = nameMap(state.players);
  if (d.action === "confirm") await confirmMatch(db, state.t.id, round, m, d.result, d.source, now, names);
  if (d.action === "dispute") {
    await db.query("update matches set disputed = true where id = $1", [m.id]);
    await logEvent(db, state.t.id, "dispute", {
      round: round.number,
      table: m.table_number,
      reason: d.reason,
      p1: names.get(m.p1_id!),
      p2: m.p2_id ? names.get(m.p2_id) : null,
    });
  }
}

export async function playerDrop(db: Db, token: string) {
  return db.tx(async (tx) => {
    const p = await playerByToken(tx, token);
    await lockTournament(tx, p.tournament_id);
    if (p.dropped) return;
    await tx.query("update players set dropped = true, drop_reason = 'saiu por conta própria' where id = $1", [p.id]);
    await logEvent(tx, p.tournament_id, "drop", { player: p.name, player_id: p.id, reason: "saiu por conta própria", by: "player" });
  });
}

// ───────────────────────── ações do admin ─────────────────────────

async function matchContext(db: Db, matchId: string) {
  const [m] = await db.query<MatchRow>("select * from matches where id = $1", [matchId]);
  if (!m) throw new UserError("Partida não encontrada.");
  const [round] = await db.query<RoundRow>("select * from rounds where id = $1", [m.round_id]);
  await lockTournament(db, round.tournament_id);
  const state = await loadState(db, round.tournament_id);
  const later = state.rounds.some((r) => r.number > round.number);
  return { m, round, state, later };
}

export async function adminSetResult(db: Db, matchId: string, result: MatchResult, note: string | null, now: Date) {
  return db.tx(async (tx) => {
    const { m, round, state, later } = await matchContext(tx, matchId);
    if (round.stage === "topcut" && (result === "tie" || result === "double_loss")) {
      throw new UserError("No top cut a partida precisa de um vencedor.");
    }
    if (later && round.stage === "topcut") throw new UserError("A fase seguinte do corte já começou.");
    if (!m.p2_id && result !== "p1") throw new UserError("Bye é sempre vitória.");
    const wasDisputed = m.disputed;
    await confirmMatch(tx, state.t.id, round, m, result, "admin", now, nameMap(state.players), note);
    if (wasDisputed) await logEvent(tx, state.t.id, "dispute_resolved", { round: round.number, table: m.table_number });
    if (round.status === "live") await maybeCloseRound(tx, state.t.id, round.id, now, "admin");
  });
}

/** Penalidade: o jogador escolhido perde a partida. */
export async function adminPenalty(db: Db, matchId: string, loserId: string, now: Date) {
  const [m] = await db.query<MatchRow>("select * from matches where id = $1", [matchId]);
  if (!m || !m.p2_id) throw new UserError("Partida inválida para penalidade.");
  if (loserId !== m.p1_id && loserId !== m.p2_id) throw new UserError("Jogador não está nessa mesa.");
  const [p] = await db.query<PlayerRow>("select * from players where id = $1", [loserId]);
  return adminSetResult(db, matchId, loserId === m.p1_id ? "p2" : "p1", `penalidade (derrota): ${p.name}`, now);
}

/** Reverte um resultado confirmado: volta para o juiz como disputa e reabre a rodada se for a última. */
export async function adminReopenMatch(db: Db, matchId: string) {
  return db.tx(async (tx) => {
    const { m, round, state, later } = await matchContext(tx, matchId);
    if (later) throw new UserError("Já existe rodada depois dessa. Corrija o resultado direto.");
    if (!m.p2_id) throw new UserError("Bye não pode ser reaberto. Use re-parear.");
    await tx.query("update matches set result = null, result_source = null, confirmed_at = null, disputed = true where id = $1", [m.id]);
    if (round.status === "closed") {
      await tx.query("update rounds set status = 'live', closed_at = null where id = $1", [round.id]);
      if (state.t.status === "finished") {
        await tx.query("update tournaments set status = $2 where id = $1", [state.t.id, round.stage === "topcut" ? "topcut" : "swiss"]);
      }
    }
    await tx.query("update tournaments set next_round_at = null where id = $1", [state.t.id]);
    const names = nameMap(state.players);
    await logEvent(tx, state.t.id, "result_reverted", { round: round.number, table: m.table_number, p1: names.get(m.p1_id!), p2: names.get(m.p2_id) });
  });
}

export async function adminAdjustTime(db: Db, roundId: string, minutes: number) {
  return db.tx(async (tx) => {
    const [round] = await tx.query<RoundRow>("select * from rounds where id = $1", [roundId]);
    if (!round || round.status !== "live" || !round.ends_at) throw new UserError("Rodada não está aberta.");
    await lockTournament(tx, round.tournament_id);
    const ends = new Date(round.ends_at.getTime() + minutes * 60_000);
    await tx.query("update rounds set ends_at = $2 where id = $1", [round.id, ends]);
    await logEvent(tx, round.tournament_id, "time_adjusted", { round: round.number, minutes, ends_at: ends.toISOString() });
  });
}

/** Desfaz a rodada aberta (apaga mesas). Com reopen=true, gera o pareamento de novo na hora. */
export async function adminUndoRound(db: Db, tournamentId: string, reopen: boolean, now: Date) {
  return db.tx(async (tx) => {
    await lockTournament(tx, tournamentId);
    const state = await loadState(tx, tournamentId);
    const live = state.rounds.find((r) => r.status === "live");
    if (!live) throw new UserError("Não há rodada aberta.");
    if (live.number !== state.rounds.at(-1)!.number) throw new UserError("Só a última rodada pode ser desfeita.");
    await tx.query("delete from rounds where id = $1", [live.id]);
    if (live.stage === "topcut" && !state.rounds.some((r) => r.stage === "topcut" && r.id !== live.id)) {
      await tx.query("update tournaments set status = 'swiss' where id = $1", [tournamentId]);
    }
    await tx.query("update tournaments set next_round_at = null where id = $1", [tournamentId]);
    await logEvent(tx, tournamentId, "round_undone", { round: live.number, reopen });
    if (reopen) await openNextRound(tx, tournamentId, now, "admin");
  });
}

export async function adminOpenNextRound(db: Db, tournamentId: string, now: Date) {
  return db.tx(async (tx) => {
    await lockTournament(tx, tournamentId);
    const r = await openNextRound(tx, tournamentId, now, "admin");
    return r;
  });
}

/** Bye manual para alguém sem mesa na rodada aberta (ex.: jogador reintegrado). */
export async function adminManualBye(db: Db, tournamentId: string, playerId: string, now: Date) {
  return db.tx(async (tx) => {
    await lockTournament(tx, tournamentId);
    const state = await loadState(tx, tournamentId);
    const live = state.rounds.find((r) => r.status === "live");
    if (!live) throw new UserError("Não há rodada aberta.");
    const ms = state.matches.filter((m) => m.round_id === live.id);
    if (ms.some((m) => m.p1_id === playerId || m.p2_id === playerId)) throw new UserError("Esse jogador já tem mesa nesta rodada.");
    const p = state.players.find((x) => x.id === playerId);
    if (!p) throw new UserError("Jogador não encontrado.");
    const table = Math.max(0, ...ms.map((m) => m.table_number)) + 1;
    await tx.query(
      `insert into matches (round_id, table_number, p1_id, p2_id, result, result_source, confirmed_at, judge_note, jitsi_room)
       values ($1, $2, $3, null, 'p1', 'bye', $4, 'bye manual', $5)`,
      [live.id, table, playerId, now, jitsiRoom(state.t.slug, live.number, table)],
    );
    await logEvent(tx, tournamentId, "bye", { round: live.number, player: p.name, player_id: p.id, manual: true });
  });
}

export async function adminDropPlayer(db: Db, playerId: string, dropped: boolean, reason: string | null) {
  return db.tx(async (tx) => {
    const [p] = await tx.query<PlayerRow>("select * from players where id = $1", [playerId]);
    if (!p) throw new UserError("Jogador não encontrado.");
    await lockTournament(tx, p.tournament_id);
    await tx.query("update players set dropped = $2, drop_reason = $3 where id = $1", [p.id, dropped, dropped ? reason || "drop pelo juiz" : null]);
    await logEvent(tx, p.tournament_id, dropped ? "drop" : "undrop", {
      player: p.name,
      player_id: p.id,
      reason: dropped ? reason || "drop pelo juiz" : undefined,
      by: "admin",
    });
  });
}

export async function adminSetCheckin(db: Db, playerId: string, checkedIn: boolean, now: Date) {
  return db.tx(async (tx) => {
    const [p] = await tx.query<PlayerRow>("select * from players where id = $1", [playerId]);
    if (!p) throw new UserError("Jogador não encontrado.");
    await lockTournament(tx, p.tournament_id);
    if (checkedIn && p.payment_status !== "paid") throw new UserError("Confirme o pagamento antes.");
    await tx.query(
      "update players set checked_in = $2, checked_in_at = $3, decklist_locked = $2, dropped = case when $2 then false else dropped end, drop_reason = case when $2 then null else drop_reason end where id = $1",
      [p.id, checkedIn, checkedIn ? now : null],
    );
    await logEvent(tx, p.tournament_id, checkedIn ? "checkin" : "checkin_undone", { player: p.name, player_id: p.id, by: "admin" });
  });
}

export async function confirmPayment(db: Db, playerId: string, ref: string | null, actor: Actor, provider = "manual") {
  return db.tx(async (tx) => {
    const [p] = await tx.query<PlayerRow>("select * from players where id = $1", [playerId]);
    if (!p) throw new UserError("Jogador não encontrado.");
    if (p.payment_status === "paid") return false;
    await tx.query("update players set payment_status = 'paid', payment_ref = coalesce($2, payment_ref) where id = $1", [p.id, ref]);
    await logEvent(tx, p.tournament_id, "payment_confirmed", { player: p.name, player_id: p.id, provider, by: actor });
    return true;
  });
}

export async function markRefunded(db: Db, playerId: string, actor: Actor, provider = "manual") {
  return db.tx(async (tx) => {
    const [p] = await tx.query<PlayerRow>("select * from players where id = $1", [playerId]);
    if (!p) throw new UserError("Jogador não encontrado.");
    if (p.payment_status === "refunded") return;
    await tx.query("update players set payment_status = 'refunded' where id = $1", [p.id]);
    await logEvent(tx, p.tournament_id, "payment_refunded", { player: p.name, player_id: p.id, provider, by: actor });
  });
}
