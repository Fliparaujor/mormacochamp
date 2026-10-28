import type { BracketRoundView, FeedItem, HubView, PrizeView, RoundView, StandingView, TableStatus } from "@/lib/server/views";
import { fmtMoney, fmtTime } from "@/lib/format";
import { formatPct } from "@/lib/engine/standings";

export const STATUS_LABEL: Record<HubView["t"]["status"], string> = {
  draft: "Rascunho",
  registration: "Inscrições abertas",
  checkin: "Check-in aberto",
  swiss: "Suíço em andamento",
  topcut: "Top cut",
  finished: "Encerrado",
  cancelled: "Cancelado",
};

export function StatusBadge({ status }: { status: HubView["t"]["status"] }) {
  const color =
    status === "cancelled"
      ? "bg-red text-cream border-cream"
      : status === "finished"
        ? "bg-sky text-navy border-navy"
        : status === "draft"
          ? "bg-cream/20 text-cream border-cream"
          : "bg-yellow text-navy border-navy";
  return <span className={`chip ${color}`}>{STATUS_LABEL[status]}</span>;
}

const TABLE_STATUS: Record<TableStatus, { label: string; cls: string }> = {
  bye: { label: "bye", cls: "bg-sky" },
  pending: { label: "jogando", cls: "bg-white" },
  one: { label: "1 reporte", cls: "bg-butter" },
  confirmed: { label: "confirmada", cls: "bg-bubble" },
  disputed: { label: "com o juiz", cls: "bg-red text-cream" },
};

export function TableStatusChip({ status }: { status: TableStatus }) {
  const s = TABLE_STATUS[status];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

function sideClass(t: RoundView["tables"][number], side: "p1" | "p2") {
  if (t.status !== "confirmed" && t.status !== "bye") return "";
  if (t.result === side) return "font-title";
  if (t.result === "tie") return "";
  return "opacity-60 line-through decoration-2";
}

export function Pairings({ round, big = false, highlightId }: { round: RoundView; big?: boolean; highlightId?: string }) {
  return (
    <ul className={`grid gap-2 ${big ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}>
      {round.tables.map((t) => {
        const mine = highlightId && (t.p1?.id === highlightId || t.p2?.id === highlightId);
        return (
          <li
            key={t.matchId}
            className={`flex items-center gap-3 rounded-2xl border-3 border-navy px-3 py-2 ${mine ? "bg-yellow" : "bg-white"} ${big ? "text-2xl" : ""}`}
          >
            <span className={`font-title tabular shrink-0 ${big ? "w-16 text-3xl" : "w-9 text-lg"}`}>
              {round.stage === "topcut" ? `#${t.table}` : t.table}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className={`block truncate ${sideClass(t, "p1")}`}>{t.p1?.name ?? "?"}</span>
              <span className={`block truncate ${sideClass(t, "p2")}`}>
                {t.p2 ? t.p2.name : <em className="opacity-70">bye</em>}
              </span>
            </span>
            {!big ? <TableStatusChip status={t.status} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function Standings({ rows, highlightId, limit }: { rows: StandingView[]; highlightId?: string; limit?: number }) {
  if (!rows.length) return <p className="text-sm opacity-80">A classificação aparece depois da rodada 1.</p>;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="-mx-1.5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b-2 border-navy">
            <th className="px-1.5 py-1">#</th>
            <th className="px-1.5 py-1">Jogador</th>
            <th className="px-1.5 py-1 text-right">Pts</th>
            <th className="px-1.5 py-1 text-right whitespace-nowrap">V-D-E</th>
            <th className="hidden px-2 py-1 text-right sm:table-cell">OWP</th>
            <th className="hidden px-2 py-1 text-right sm:table-cell">Op-OWP</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {shown.map((r) => (
            <tr key={r.playerId} className={`border-b border-navy/20 ${r.playerId === highlightId ? "bg-yellow" : ""} ${r.dropped ? "opacity-50" : ""}`}>
              <td className="px-1.5 py-1 font-title">{r.rank}</td>
              <td className="px-1.5 py-1">
                <span className="block max-w-[9.5rem] truncate sm:max-w-none">{r.name}</span>
                {r.dropped ? <span className="text-xs">saiu</span> : null}
              </td>
              <td className="px-1.5 py-1 text-right font-title">{r.points}</td>
              <td className="px-1.5 py-1 text-right whitespace-nowrap">
                {r.wins + r.byes}-{r.losses}-{r.ties}
              </td>
              <td className="hidden px-2 py-1 text-right sm:table-cell">{formatPct(r.owp)}</td>
              <td className="hidden px-2 py-1 text-right sm:table-cell">{formatPct(r.oowp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Bracket({ rounds }: { rounds: BracketRoundView[] }) {
  if (!rounds.length) return null;
  return (
    <div className="-mx-2 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-4 px-2">
        {rounds.map((r) => (
          <div key={r.label} className="flex w-48 flex-col justify-around gap-3">
            <h4 className="font-title text-center">{r.label}</h4>
            {r.matches.map((m) => (
              <div key={m.table} className="overflow-hidden rounded-2xl border-3 border-navy bg-white text-sm">
                {(["p1", "p2"] as const).map((s) => (
                  <div
                    key={s}
                    className={`truncate px-3 py-1.5 ${s === "p1" ? "border-b-2 border-navy/30" : ""} ${m.winner === s ? "bg-yellow font-title" : m.winner ? "opacity-50" : ""}`}
                  >
                    {m[s] ?? "a definir"}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Feed({ items }: { items: FeedItem[] }) {
  if (!items.length) return <p className="text-sm opacity-80">Nada por aqui ainda.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((e) => (
        <li key={e.id} className="flex gap-2">
          <span className="tabular shrink-0 opacity-70">{fmtTime(e.at)}</span>
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrizeBox({ prize }: { prize: PrizeView }) {
  const n = prize.players;
  return (
    <div>
      {prize.band ? (
        <>
          <p className="text-lg">
            Agora o prêmio é <span className="highlight font-title">{fmtMoney(prize.band.prizes[0])}</span> pro campeão
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {prize.band.prizes.map((c, i) => (
              <li key={i} className="chip bg-white">
                {i + 1}º {fmtMoney(c)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>O prêmio começa a valer com {prize.next?.min ?? 8} jogadores.</p>
      )}
      <p className="mt-2 text-sm opacity-80">
        {n} {prize.basis === "pagos" ? "inscritos pagos" : "jogadores com check-in"}
        {prize.next ? ` · com ${prize.next.min} sobe pra ${fmtMoney(prize.next.prizes[0])}` : ""}
      </p>
      <p className="mt-1 text-xs opacity-70">Crédito na loja, 60 dias, sem troca por dinheiro.</p>
    </div>
  );
}

export function Section({ title, children, tone = "card", id }: { title?: React.ReactNode; children: React.ReactNode; tone?: "card" | "card-butter" | "card-dark"; id?: string }) {
  return (
    <section id={id} className={`${tone} p-4 sm:p-5`}>
      {title ? <h2 className="font-title mb-3 text-xl">{title}</h2> : null}
      {children}
    </section>
  );
}
