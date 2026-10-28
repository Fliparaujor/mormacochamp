import type { EngineMatch, MatchResult, Pairing, StandingRow } from "./types";

/** Ordem das seeds na chave: 8 → [1,8,4,5,2,7,3,6]; 4 → [1,4,2,3]. */
export function bracketSeedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order.slice(0, size);
}

/** Primeira rodada do corte a partir da classificação final do suíço (dropped ficam fora). */
export function firstCutPairings(standings: StandingRow[], size: number): Pairing[] {
  const qualified = standings.filter((s) => !s.dropped).slice(0, size).map((s) => s.playerId);
  if (qualified.length < 2) return [];
  const realSize = qualified.length >= size ? size : largestPowerOfTwo(qualified.length);
  const order = bracketSeedOrder(realSize);
  const out: Pairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    out.push({ tableNumber: i / 2 + 1, p1: qualified[order[i] - 1], p2: qualified[order[i + 1] - 1] });
  }
  return out;
}

export function matchWinner(m: { p1: string; p2: string | null; result: MatchResult | null }): string | null {
  if (m.p2 === null) return m.p1;
  if (m.result === "p1") return m.p1;
  if (m.result === "p2") return m.p2;
  return null;
}

export function matchLoser(m: { p1: string; p2: string | null; result: MatchResult | null }): string | null {
  if (m.p2 === null) return null;
  if (m.result === "p1") return m.p2;
  if (m.result === "p2") return m.p1;
  return null;
}

/**
 * Próxima rodada do corte: vencedores na ordem das mesas, 1×2, 3×4...
 * Devolve null se alguma partida ainda não tem vencedor, e [] se a rodada anterior era a final.
 */
export function nextCutPairings(prev: EngineMatch[]): Pairing[] | null {
  const sorted = [...prev].sort((a, b) => a.tableNumber - b.tableNumber);
  const winners: string[] = [];
  for (const m of sorted) {
    const w = matchWinner(m);
    if (!w) return null;
    winners.push(w);
  }
  if (winners.length <= 1) return [];
  const out: Pairing[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    out.push({ tableNumber: i / 2 + 1, p1: winners[i], p2: winners[i + 1] ?? null });
  }
  return out;
}

export function cutRoundLabel(playersInRound: number): string {
  if (playersInRound <= 2) return "Final";
  if (playersInRound <= 4) return "Semifinal";
  if (playersInRound <= 8) return "Quartas de final";
  return "Oitavas de final";
}

/**
 * Colocação final. No corte, quem foi mais longe fica na frente; quem caiu na mesma fase
 * é ordenado pela classificação do suíço (não há disputa de 3º lugar). Fora do corte,
 * vale a classificação do suíço.
 */
export function finalPlacements(swiss: StandingRow[], cutMatches: EngineMatch[]): string[] {
  const swissRank = new Map(swiss.map((s) => [s.playerId, s.rank]));
  if (cutMatches.length === 0) return swiss.map((s) => s.playerId);
  const depth = new Map<string, number>();
  const rounds = [...new Set(cutMatches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  rounds.forEach((r, idx) => {
    for (const m of cutMatches.filter((x) => x.roundNumber === r)) {
      depth.set(m.p1, idx + 1);
      if (m.p2) depth.set(m.p2, idx + 1);
      const w = matchWinner(m);
      if (w) depth.set(w, idx + 1.5);
    }
  });
  const cutPlayers = [...depth.keys()].sort(
    (a, b) => depth.get(b)! - depth.get(a)! || (swissRank.get(a) ?? 999) - (swissRank.get(b) ?? 999),
  );
  const inCut = new Set(cutPlayers);
  return [...cutPlayers, ...swiss.filter((s) => !inCut.has(s.playerId)).map((s) => s.playerId)];
}

function largestPowerOfTwo(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}
