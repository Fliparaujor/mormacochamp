import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/server/db";
import { getTournamentBySlug } from "@/lib/server/tournament";
import { hubView } from "@/lib/server/views";
import { Footer, Header, Page, TournamentTitle } from "@/components/brand";
import { Bracket, Feed, Pairings, PrizeBox, Section, Standings, StatusBadge } from "@/components/tournament";
import { LiveUpdater } from "@/components/live";
import { BigClock, deadlinesOf, Podium } from "@/components/hub-parts";
import { MyPageShortcut } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = await getTournamentBySlug(getDb(), (await params).slug);
  return { title: t?.name ?? "Torneio" };
}

export default async function Hub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const t = await getTournamentBySlug(db, slug);
  if (!t || (t.status === "draft" && !t.is_simulation)) notFound();
  const v = await hubView(db, t.id);
  const live = v.round?.status === "live";
  const showPairings = v.round && v.t.status !== "finished";

  return (
    <Page>
      <LiveUpdater tournamentId={t.id} deadlines={deadlinesOf(v)} active={!["finished", "cancelled"].includes(t.status)} />
      <Header right={<MyPageShortcut slug={slug} />} />
      {v.t.isSimulation ? <p className="chip mt-2 border-cream bg-red text-cream">Simulação · não é um torneio real</p> : null}

      <div className="mt-4 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <div>
            <StatusBadge status={v.t.status} />
            <TournamentTitle name={v.t.name} className="mt-3 text-4xl sm:text-5xl" />
            <p className="mt-2 text-lg text-cream/85">
              {fmtDateTime(v.t.startsAt)} · Standard · Bo1 · {v.t.roundMinutes} min · {fmtMoney(v.t.entryFeeCents)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {v.t.status === "registration" || v.t.status === "checkin" ? (
                <Link href={`/t/${slug}/inscricao`} className="btn btn-primary">
                  Quero me inscrever
                </Link>
              ) : null}
              <Link href={`/t/${slug}/regulamento`} className="btn btn-light btn-sm">
                Regulamento
              </Link>
              {v.t.whatsappGroupUrl ? (
                <a href={v.t.whatsappGroupUrl} className="btn btn-neutral btn-sm" target="_blank" rel="noreferrer">
                  Grupo do WhatsApp
                </a>
              ) : null}
              <Link href={`/t/${slug}/display`} className="btn btn-light btn-sm">
                Modo telão
              </Link>
            </div>
          </div>

          {v.t.status === "cancelled" ? (
            <Section tone="card">
              <p className="text-lg">Torneio cancelado. Quem pagou recebe o Pix de volta em até 24h.</p>
            </Section>
          ) : null}

          {v.placements.length ? <Podium v={v} /> : null}

          {!["finished", "cancelled"].includes(v.t.status) ? (
            <Section tone="card-butter">
              <BigClock v={v} />
              {!live && !v.t.nextRoundAt && v.t.status !== "registration" && v.t.status !== "checkin" ? (
                <p className="text-lg">Aguardando o juiz.</p>
              ) : null}
            </Section>
          ) : null}

          {showPairings && v.round ? (
            <Section title={`${v.round.label} · ${live ? "ao vivo" : "resultados"}`}>
              <Pairings round={v.round} />
            </Section>
          ) : null}

          {v.bracket.length ? (
            <Section title="Chave do top cut">
              <Bracket rounds={v.bracket} />
            </Section>
          ) : null}

          {v.standings.length ? (
            <Section title="Classificação">
              <Standings rows={v.standings} />
            </Section>
          ) : null}
        </div>

        <div className="space-y-5">
          <Section title="Prêmio" tone="card-butter">
            <PrizeBox prize={v.prize} />
          </Section>
          <Section title={`Inscritos (${v.counts.paid}/${v.t.maxPlayers})`}>
            {v.players.length ? (
              <ul className="space-y-1 text-sm">
                {v.players.map((p) => (
                  <li key={p.tcglive} className={`flex justify-between gap-2 ${p.dropped ? "opacity-50" : ""}`}>
                    <span className="truncate">{p.name}</span>
                    <span className="truncate opacity-75">
                      {p.tcglive}
                      {v.t.status === "checkin" && p.checkedIn ? " ✓" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">Ninguém confirmado ainda. Seja o primeiro.</p>
            )}
            {v.t.status === "checkin" ? <p className="mt-2 text-sm font-bold">{v.counts.checkedIn} fizeram check-in</p> : null}
          </Section>
          <Section title="Ao vivo" tone="card-dark">
            <Feed items={v.feed} />
          </Section>
        </div>
      </div>
      <Footer />
    </Page>
  );
}
