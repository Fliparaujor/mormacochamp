import { fmtHour, fmtMoney } from "./format";

const SOURCE: Record<string, string> = {
  both: "os dois confirmaram",
  auto: "confirmado por tempo",
  admin: "registrado pelo juiz",
  bye: "bye",
};

function resultText(p: Record<string, any>): string {
  const r = p.result;
  if (r === "p1") return `${p.p1} venceu ${p.p2}`;
  if (r === "p2") return `${p.p2} venceu ${p.p1}`;
  if (r === "tie") return `${p.p1} e ${p.p2} empataram`;
  if (r === "double_loss") return `derrota dupla para ${p.p1} e ${p.p2}`;
  return "resultado";
}

/** Texto do evento para o feed. `admin=true` mostra também os eventos internos. */
export function eventText(type: string, p: Record<string, any>, admin = false): string | null {
  switch (type) {
    case "registration":
      return `${p.player} se inscreveu`;
    case "payment_confirmed":
      return `Pix de ${p.player} confirmado`;
    case "payment_refunded":
      return admin ? `Pix de ${p.player} devolvido` : null;
    case "pix_created":
      return admin ? `Cobrança Pix gerada para ${p.player}` : null;
    case "checkin_opened":
      return "Check-in aberto";
    case "checkin":
      return `${p.player} fez check-in`;
    case "checkin_undone":
      return admin ? `Check-in de ${p.player} desfeito` : null;
    case "checkin_closed":
      return `Check-in fechado: ${p.count} jogadores`;
    case "drop":
      return `${p.player} saiu do torneio (${p.reason})`;
    case "undrop":
      return `${p.player} voltou ao torneio`;
    case "seeds_drawn":
      return "Seeds sorteadas";
    case "structure":
      return `${p.players} jogadores: ${p.swiss_rounds} rodadas suíças${p.top_cut ? ` + top ${p.top_cut}` : ""}`;
    case "cancelled":
      return p.reason === "quorum"
        ? `Torneio cancelado: ${p.count} de ${p.min} jogadores mínimos`
        : "Torneio cancelado";
    case "round_opened":
      return `${p.label} começou · ${p.minutes} min · até ${fmtHour(p.ends_at)}`;
    case "bye":
      return `${p.player} recebeu bye na rodada ${p.round}`;
    case "rematch_forced":
      return `Rematch forçado na rodada ${p.round}: ${p.p1} × ${p.p2}`;
    case "report":
      return admin ? `Mesa ${p.table}: ${p.player} reportou ${p.report === "win" ? "vitória" : "derrota"}` : null;
    case "result":
      return `Mesa ${p.table}: ${resultText(p)} (${SOURCE[p.source] ?? p.source})${admin && p.note ? ` · ${p.note}` : ""}`;
    case "dispute":
      return p.reason === "no_report" ? `Mesa ${p.table} sem reporte: com o juiz` : `Mesa ${p.table} em disputa: com o juiz`;
    case "dispute_resolved":
      return `Disputa da mesa ${p.table} resolvida`;
    case "result_reverted":
      return `Resultado da mesa ${p.table} (rodada ${p.round}) revertido pelo juiz`;
    case "round_closed":
      return `${p.label} encerrada`;
    case "next_round_scheduled":
      return `Próxima rodada às ${fmtHour(p.at)}`;
    case "round_undone":
      return p.reopen ? `Rodada ${p.round} re-pareada pelo juiz` : `Rodada ${p.round} desfeita pelo juiz`;
    case "time_adjusted":
      return `Tempo da rodada ${p.round} ajustado (${p.minutes > 0 ? "+" : ""}${p.minutes} min, até ${fmtHour(p.ends_at)})`;
    case "lottery_tiebreak":
      return `Desempate por sorteio: ${p.above} à frente de ${p.below}`;
    case "topcut_started":
      return `Top ${p.size} definido`;
    case "finished":
      return `Fim de torneio. Campeão: ${p.champion}`;
    case "decklist_updated":
      return admin ? `${p.player} atualizou a lista (${p.cards} cartas)` : null;
    case "simulation_started":
      return `Simulação iniciada com ${p.players} jogadores`;
    case "refund_failed":
      return admin ? `Falha ao devolver Pix: ${p.error}` : null;
    case "tournament_created":
      return admin ? `Torneio criado: ${p.name}` : null;
    case "player_edited":
      return admin ? `Dados de ${p.player} editados pelo juiz` : null;
    case "tournament_updated":
      return admin ? "Configuração do torneio alterada" : null;
    case "auto_mode":
      return admin ? `Modo automático ${p.on ? "ligado" : "desligado"}` : null;
    case "status_changed":
      return admin ? `Status alterado para ${p.status}` : null;
    default:
      return admin ? type : null;
  }
}

export function prizeLine(prizes: number[]): string {
  return prizes.map((c, i) => `${i + 1}º ${fmtMoney(c)}`).join(" · ");
}
