import type { HubView } from "@/lib/server/views";
import { After, Countdown } from "@/components/live";
import { Section } from "@/components/tournament";
import { fmtMoney, fmtTime } from "@/lib/format";

export function deadlinesOf(v: HubView): string[] {
  const out = [v.t.checkinOpensAt, v.t.checkinClosesAt, v.t.nextRoundAt].filter(Boolean) as string[];
  if (v.round?.endsAt && v.round.status === "live") {
    const e = new Date(v.round.endsAt).getTime();
    out.push(v.round.endsAt, new Date(e + 5 * 60_000).toISOString(), new Date(e + 10 * 60_000).toISOString());
  }
  return out;
}

export function BigClock({ v, huge = false }: { v: HubView; huge?: boolean }) {
  const { t, round } = v;
  const lbl = huge ? "font-title text-3xl sm:text-4xl" : "font-title text-lg";
  const num = huge ? "font-title block text-8xl leading-none sm:text-[11rem]" : "font-title block text-6xl";
  if (round?.status === "live" && round.endsAt) {
    return (
      <div>
        <p className={lbl}>{round.label} · até {fmtTime(round.endsAt)}</p>
        <Countdown
          to={round.endsAt}
          serverNow={v.serverNow}
          className={huge ? num : "font-title block text-6xl sm:text-7xl"}
          expired={<span className="font-title block text-3xl text-red sm:text-4xl">Tempo acabou</span>}
        />
        <After at={round.endsAt} serverNow={v.serverNow}>
          <p className="mt-1 text-sm">Vence quem tem mais cartas de prêmio. Empatou, chama o juiz.</p>
        </After>
      </div>
    );
  }
  if (t.nextRoundAt) {
    return (
      <div>
        <p className={lbl}>Próxima rodada começa em</p>
        <Countdown to={t.nextRoundAt} serverNow={v.serverNow} className={num} expired={<span className="font-title text-3xl">saindo agora</span>} />
      </div>
    );
  }
  if (t.status === "checkin" && t.checkinClosesAt) {
    return (
      <div>
        <p className={lbl}>Check-in fecha em</p>
        <Countdown to={t.checkinClosesAt} serverNow={v.serverNow} className={num} expired={<span className="font-title text-3xl">fechando</span>} />
      </div>
    );
  }
  if ((t.status === "registration" || t.status === "draft") && t.checkinOpensAt) {
    return (
      <div>
        <p className={lbl}>Check-in abre em</p>
        <Countdown to={t.checkinOpensAt} serverNow={v.serverNow} className={num} />
      </div>
    );
  }
  return null;
}

export function Podium({ v }: { v: HubView }) {
  const [first, ...rest] = v.placements;
  const prized = rest.filter((p) => p.prizeCents > 0 || p.place <= 4).slice(0, 7);
  return (
    <Section tone="card-butter">
      <p className="font-title text-lg">Campeão</p>
      <p className="font-title text-4xl">
        <span className="highlight">{first.name}</span>
      </p>
      {first.prizeCents ? <p className="mt-1">{fmtMoney(first.prizeCents)} em crédito na loja</p> : null}
      <ol className="mt-4 space-y-1">
        {prized.map((p) => (
          <li key={p.playerId} className="flex justify-between gap-2">
            <span>
              <span className="font-title">{p.place}º</span> {p.name}
            </span>
            {p.prizeCents ? <span className="font-title">{fmtMoney(p.prizeCents)}</span> : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}
