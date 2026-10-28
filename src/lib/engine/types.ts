// Tipos puros do motor do torneio. Nada aqui depende de banco ou rede.

export type MatchResult = "p1" | "p2" | "tie" | "double_loss";
export type Report = "win" | "loss";
export type Stage = "swiss" | "topcut";

export interface EnginePlayer {
  id: string;
  name?: string;
  seed: number; // sorteado no fechamento do check-in; também é o sorteio de desempate
  dropped: boolean;
}

export interface EngineMatch {
  roundNumber: number;
  stage: Stage;
  tableNumber: number;
  p1: string;
  p2: string | null; // null = bye
  result: MatchResult | null;
}

export interface StandingRow {
  playerId: string;
  rank: number;
  matchPoints: number;
  wins: number;
  losses: number;
  ties: number;
  byes: number;
  played: number; // partidas contra oponente (sem bye)
  winPct: number; // com piso de 25%
  owp: number;
  oowp: number;
  seed: number;
  dropped: boolean;
  opponents: string[];
}

export interface Pairing {
  tableNumber: number;
  p1: string;
  p2: string | null;
}

export interface PairingOutcome {
  pairings: Pairing[];
  forcedRematches: Array<[string, string]>;
  byePlayer: string | null;
}
