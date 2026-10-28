import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { getTournamentBySlug } from "@/lib/server/tournament";
import { hubView } from "@/lib/server/views";
import { Logo, TournamentTitle } from "@/components/brand";
import { LiveUpdater } from "@/components/live";
import { BigClock, deadlinesOf } from "@/components/hub-parts";
import { Bracket, Pairings } from "@/components/tournament";

export const dynamic = "force-dynamic";
export const metadata = { title: "Telão" };

export default async function Display({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const t = await getTournamentBySlug(db, slug);
  if (!t) notFound();
  const v = await hubView(db, t.id);
  return (
    <div className="halftone min-h-dvh p-4 sm:p-8">
      <LiveUpdater tournamentId={t.id} deadlines={deadlinesOf(v)} pollMs={8000} />
      <div className="flex items-start justify-between gap-4">
        <TournamentTitle name={v.t.name} className="text-4xl sm:text-6xl" />
        <Logo className="text-4xl" />
      </div>
      <div className="card-butter mt-6 p-6 text-center">
        <BigClock v={v} />
        {v.placements[0] ? (
          <p className="font-title text-5xl">
            Campeão: <span className="highlight">{v.placements[0].name}</span>
          </p>
        ) : null}
      </div>
      {v.round && v.t.status !== "finished" ? (
        <div className="card mt-6 p-4 sm:p-6">
          <h2 className="font-title mb-4 text-3xl">{v.round.label}</h2>
          <Pairings round={v.round} big />
        </div>
      ) : null}
      {v.bracket.length && (v.t.status === "topcut" || v.t.status === "finished") ? (
        <div className="card mt-6 p-4 sm:p-6">
          <Bracket rounds={v.bracket} />
        </div>
      ) : null}
    </div>
  );
}
