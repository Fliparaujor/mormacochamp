import type { EngineMatch, EnginePlayer, StandingRow } from "./types";

export const POINTS = { win: 3, tie: 1, loss: 0, bye: 3 } as const;
export const WIN_PCT_FLOOR = 0.25;

const EPS = 1e-9;

/**
 * Classificação do suíço.
 *
 * - Pontos: vitória 3, empate 1, derrota 0, bye 3. Derrota dupla = derrota para os dois.
 * - Win% de um jogador = (3·V + E) / (3·partidas jogadas), sem contar byes, com piso de 25%.
 * - OWP = média do win% dos oponentes enfrentados (bye não é oponente).
 * - Op-OWP (OOWP) = média do OWP desses mesmos oponentes.
 * - Ordem: pontos → OWP → OOWP → sorteio (seed sorteada no fechamento do check-in, menor primeiro).
 *
 * Só entram partidas do suíço com resultado definido.
 */
export function computeStandings(players: EnginePlayer[], matches: EngineMatch[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const p of players) {
    rows.set(p.id, {
      playerId: p.id,
      rank: 0,
      matchPoints: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      byes: 0,
      played: 0,
      winPct: WIN_PCT_FLOOR,
      owp: 0,
      oowp: 0,
      seed: p.seed,
      dropped: p.dropped,
      opponents: [],
    });
  }

  for (const m of matches) {
    if (m.stage !== "swiss" || m.result === null) continue;
    const a = rows.get(m.p1);
    if (!a) continue;
    if (m.p2 === null) {
      a.byes += 1;
      continue;
    }
    const b = rows.get(m.p2);
    if (!b) continue;
    a.opponents.push(b.playerId);
    b.opponents.push(a.playerId);
    a.played += 1;
    b.played += 1;
    switch (m.result) {
      case "p1":
        a.wins += 1;
        b.losses += 1;
        break;
      case "p2":
        b.wins += 1;
        a.losses += 1;
        break;
      case "tie":
        a.ties += 1;
        b.ties += 1;
        break;
      case "double_loss":
        a.losses += 1;
        b.losses += 1;
        break;
    }
  }

  for (const r of rows.values()) {
    r.matchPoints = r.wins * POINTS.win + r.ties * POINTS.tie + r.byes * POINTS.bye;
    r.winPct = winPercentage(r.wins, r.ties, r.played);
  }
  for (const r of rows.values()) {
    r.owp = average(r.opponents.map((o) => rows.get(o)!.winPct));
  }
  for (const r of rows.values()) {
    r.oowp = average(r.opponents.map((o) => rows.get(o)!.owp));
  }

  const sorted = [...rows.values()].sort(compareStanding);
  sorted.forEach((r, i) => (r.rank = i + 1));
  return sorted;
}

export function winPercentage(wins: number, ties: number, played: number): number {
  if (played <= 0) return WIN_PCT_FLOOR;
  return Math.max(WIN_PCT_FLOOR, (wins * POINTS.win + ties * POINTS.tie) / (played * POINTS.win));
}

export function compareStanding(a: StandingRow, b: StandingRow): number {
  if (a.matchPoints !== b.matchPoints) return b.matchPoints - a.matchPoints;
  if (Math.abs(a.owp - b.owp) > EPS) return b.owp - a.owp;
  if (Math.abs(a.oowp - b.oowp) > EPS) return b.oowp - a.oowp;
  return a.seed - b.seed;
}

/** Jogadores empatados em pontos, OWP e OOWP: o desempate final foi pelo sorteio. */
export function tiesBrokenByLottery(rows: StandingRow[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (
      a.matchPoints === b.matchPoints &&
      Math.abs(a.owp - b.owp) <= EPS &&
      Math.abs(a.oowp - b.oowp) <= EPS
    ) {
      out.push([a.playerId, b.playerId]);
    }
  }
  return out;
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
