import type { MatchResult, Report } from "./types";

export const AUTO_CONFIRM_GRACE_MS = 5 * 60_000; // só um reportou: confirma 5 min após o fim do tempo
export const REPORT_CLOSE_MS = 10 * 60_000; // ninguém reportou: vira disputa 10 min após o fim do tempo

export interface MatchState {
  p2: string | null;
  p1Report: Report | null;
  p2Report: Report | null;
  result: MatchResult | null;
  disputed: boolean;
}

export type MatchDecision =
  | { action: "none" }
  | { action: "confirm"; result: MatchResult; source: "both" | "auto" | "bye" }
  | { action: "dispute"; reason: "conflict" | "no_report" };

export function reportToResult(side: "p1" | "p2", report: Report): "p1" | "p2" {
  if (side === "p1") return report === "win" ? "p1" : "p2";
  return report === "win" ? "p2" : "p1";
}

/** Resultado já resolvido (confirmado e sem disputa aberta). */
export function isResolved(m: Pick<MatchState, "result" | "disputed">): boolean {
  return m.result !== null && !m.disputed;
}

/**
 * Decide o que fazer com uma partida dado o estado dos reportes e o relógio.
 * 1. Os dois reportam o mesmo → confirmado (both).
 * 2. Reportam diferente → disputa para o juiz.
 * 3. Só um reportou e passou fim do tempo + 5 min → confirma pelo reporte único (auto).
 * 4. Bye → vitória automática.
 * Extra: ninguém reportou até fim do tempo + 10 min → disputa (nunca empate automático).
 */
export function decideMatch(m: MatchState, now: Date, endsAt: Date | null): MatchDecision {
  if (isResolved(m)) return { action: "none" };
  if (m.disputed) return { action: "none" }; // juiz resolve
  if (m.p2 === null) return { action: "confirm", result: "p1", source: "bye" };

  const r1 = m.p1Report ? reportToResult("p1", m.p1Report) : null;
  const r2 = m.p2Report ? reportToResult("p2", m.p2Report) : null;

  if (r1 && r2) {
    if (r1 === r2) return { action: "confirm", result: r1, source: "both" };
    return { action: "dispute", reason: "conflict" };
  }
  if (!endsAt) return { action: "none" };
  const elapsed = now.getTime() - endsAt.getTime();
  const single = r1 ?? r2;
  if (single) {
    if (elapsed >= AUTO_CONFIRM_GRACE_MS) return { action: "confirm", result: single, source: "auto" };
    return { action: "none" };
  }
  if (elapsed >= REPORT_CLOSE_MS) return { action: "dispute", reason: "no_report" };
  return { action: "none" };
}

/** Jogadores podem reportar até a rodada fechar para reporte (fim + 10 min) ou a partida ser resolvida. */
export function canReport(m: MatchState, now: Date, endsAt: Date | null): boolean {
  if (m.p2 === null) return false;
  if (isResolved(m) || m.disputed) return false;
  if (!endsAt) return true;
  return now.getTime() - endsAt.getTime() < REPORT_CLOSE_MS;
}
