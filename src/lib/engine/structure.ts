export interface TournamentStructure {
  swissRounds: number;
  topCut: number; // 0 = sem corte
}

/**
 * Estrutura automática pelo número de jogadores com check-in.
 * 8–15: 4 rodadas + top 4. 16–32: 5 rodadas + top 8.
 * Fora dessa faixa (só acontece com min/max alterados ou simulação):
 * 2–3: 2 rodadas sem corte; 4–7: 3 rodadas + top 2; 33+: 6 rodadas + top 8.
 */
export function autoStructure(players: number): TournamentStructure {
  if (players <= 1) return { swissRounds: 0, topCut: 0 };
  if (players <= 3) return { swissRounds: 2, topCut: 0 };
  if (players <= 7) return { swissRounds: 3, topCut: 2 };
  if (players <= 15) return { swissRounds: 4, topCut: 4 };
  if (players <= 32) return { swissRounds: 5, topCut: 8 };
  return { swissRounds: 6, topCut: 8 };
}

export function resolveStructure(
  players: number,
  overrides: { swissRounds?: number | null; topCut?: number | null },
): TournamentStructure {
  const auto = autoStructure(players);
  const swissRounds = overrides.swissRounds && overrides.swissRounds > 0 ? overrides.swissRounds : auto.swissRounds;
  let topCut = overrides.topCut ?? auto.topCut;
  // Corte precisa ser potência de 2 e caber no número de jogadores.
  if (![0, 2, 4, 8, 16].includes(topCut)) topCut = auto.topCut;
  while (topCut > players) topCut = topCut / 2;
  if (topCut < 2) topCut = 0;
  return { swissRounds, topCut };
}

export interface PrizeBand {
  min: number;
  max: number;
  prizes: number[]; // centavos, 1º lugar primeiro
}

export const DEFAULT_PRIZE_TABLE: PrizeBand[] = [
  { min: 8, max: 11, prizes: [7000, 4000] },
  { min: 12, max: 19, prizes: [10000, 4500, 2500] },
  { min: 20, max: 27, prizes: [14000, 7000, 4500, 2500] },
  { min: 28, max: 32, prizes: [20000, 10000, 6000, 4000] },
];

export function prizeBandFor(players: number, table: PrizeBand[] = DEFAULT_PRIZE_TABLE): PrizeBand | null {
  const sorted = [...table].sort((a, b) => a.min - b.min);
  const exact = sorted.find((b) => players >= b.min && players <= b.max);
  if (exact) return exact;
  // Acima da maior faixa: usa a maior.
  const last = sorted[sorted.length - 1];
  if (last && players > last.max) return last;
  return null;
}

export function nextPrizeBand(players: number, table: PrizeBand[] = DEFAULT_PRIZE_TABLE): PrizeBand | null {
  return [...table].sort((a, b) => a.min - b.min).find((b) => b.min > players) ?? null;
}
