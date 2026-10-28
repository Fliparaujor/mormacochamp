import type { EngineMatch, Pairing, PairingOutcome, StandingRow } from "./types";

const DEFAULT_STEP_BUDGET = 200_000;

export interface SwissPairingInput {
  roundNumber: number;
  /** Classificação atual, já ordenada (rank 1 primeiro). Pode conter dropped: são ignorados. */
  standings: StandingRow[];
  /** Partidas suíças anteriores, para saber oponentes e byes. */
  pastMatches: EngineMatch[];
  stepBudget?: number;
}

/**
 * Pareamento suíço.
 *
 * Rodada 1: ordem da seed sorteada no check-in (1×2, 3×4, ...), bye para a última seed.
 * Demais: lista ordenada pela classificação; cada jogador, de cima pra baixo, pega o
 * próximo disponível mais próximo na tabela que ainda não enfrentou. Assim os grupos de
 * pontos são pareados internamente e o ímpar de cada grupo desce para o seguinte.
 * Quando o caminho guloso trava, o backtracking (DFS) volta e tenta a próxima opção.
 * O bye vai para o último colocado que ainda não teve bye (e cujo bye permite um
 * pareamento sem rematch). Se não existir pareamento sem rematch, aceita o mínimo de
 * rematches possível pela ordem da busca e devolve a lista em `forcedRematches`.
 */
export function pairSwissRound(input: SwissPairingInput): PairingOutcome {
  const budget = input.stepBudget ?? DEFAULT_STEP_BUDGET;
  const byeCount = new Map<string, number>();
  const opponents = new Map<string, Set<string>>();
  for (const m of input.pastMatches) {
    if (m.stage !== "swiss") continue;
    if (m.p2 === null) {
      byeCount.set(m.p1, (byeCount.get(m.p1) ?? 0) + 1);
      continue;
    }
    if (!opponents.has(m.p1)) opponents.set(m.p1, new Set());
    if (!opponents.has(m.p2)) opponents.set(m.p2, new Set());
    opponents.get(m.p1)!.add(m.p2);
    opponents.get(m.p2)!.add(m.p1);
  }
  const played = (a: string, b: string) => opponents.get(a)?.has(b) ?? false;

  let active = input.standings.filter((s) => !s.dropped);
  if (input.roundNumber === 1 || input.pastMatches.length === 0) {
    active = [...active].sort((a, b) => a.seed - b.seed);
  }
  const ids = active.map((s) => s.playerId);

  if (ids.length === 0) return { pairings: [], forcedRematches: [], byePlayer: null };
  if (ids.length === 1) {
    return { pairings: [{ tableNumber: 1, p1: ids[0], p2: null }], forcedRematches: [], byePlayer: ids[0] };
  }

  if (ids.length % 2 === 0) {
    const strict = matchList(ids, played, false, budget);
    const pairs = strict ?? matchList(ids, played, true, budget)!;
    return build(pairs, null, played);
  }

  // Ímpar: escolhe quem recebe o bye. Menos byes primeiro, depois do último colocado para cima.
  const byeCandidates = ids
    .map((id, idx) => ({ id, idx, byes: byeCount.get(id) ?? 0 }))
    .sort((a, b) => a.byes - b.byes || b.idx - a.idx);

  for (const cand of byeCandidates) {
    const rest = ids.filter((id) => id !== cand.id);
    const strict = matchList(rest, played, false, budget);
    if (strict) return build(strict, cand.id, played);
  }
  const bye = byeCandidates[0].id;
  const rest = ids.filter((id) => id !== bye);
  return build(matchList(rest, played, true, budget)!, bye, played);
}

function build(
  pairs: Array<[string, string]>,
  bye: string | null,
  played: (a: string, b: string) => boolean,
): PairingOutcome {
  const pairings: Pairing[] = pairs.map(([p1, p2], i) => ({ tableNumber: i + 1, p1, p2 }));
  if (bye) pairings.push({ tableNumber: pairings.length + 1, p1: bye, p2: null });
  const forcedRematches = pairs.filter(([a, b]) => played(a, b));
  return { pairings, forcedRematches, byePlayer: bye };
}

/**
 * Emparelha a lista na ordem dada (DFS com backtracking).
 * allowRematch=false: nunca repete oponente; devolve null se impossível (ou orçamento estourado).
 * allowRematch=true: tenta sem rematch primeiro em cada passo; sempre encontra solução.
 */
export function matchList(
  ids: string[],
  played: (a: string, b: string) => boolean,
  allowRematch: boolean,
  budget = DEFAULT_STEP_BUDGET,
): Array<[string, string]> | null {
  const n = ids.length;
  if (n % 2 !== 0) throw new Error("matchList precisa de quantidade par");
  const used = new Array<boolean>(n).fill(false);
  const pairs: Array<[string, string]> = [];
  let steps = 0;

  const rec = (): boolean => {
    let i = 0;
    while (i < n && used[i]) i++;
    if (i === n) return true;
    used[i] = true;
    const candidates: number[] = [];
    const rematches: number[] = [];
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      if (played(ids[i], ids[j])) rematches.push(j);
      else candidates.push(j);
    }
    const order = allowRematch ? [...candidates, ...rematches] : candidates;
    for (const j of order) {
      if (++steps > budget) break;
      used[j] = true;
      pairs.push([ids[i], ids[j]]);
      if (rec()) return true;
      pairs.pop();
      used[j] = false;
    }
    used[i] = false;
    return false;
  };

  if (rec()) return pairs;
  if (allowRematch) {
    // Orçamento estourado: emparelha em sequência (sempre válido quando rematch é permitido).
    const out: Array<[string, string]> = [];
    for (let k = 0; k < n; k += 2) out.push([ids[k], ids[k + 1]]);
    return out;
  }
  return null;
}
