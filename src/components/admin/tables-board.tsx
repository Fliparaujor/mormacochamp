"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui";
import { jitsiUrl } from "@/components/jitsi";
import { setResultAction } from "@/app/actions/admin";

export interface AdminTable {
  matchId: string;
  table: number;
  p1: { id: string; name: string; tcglive: string } | null;
  p2: { id: string; name: string; tcglive: string } | null;
  status: "bye" | "pending" | "one" | "confirmed" | "disputed";
  result: "p1" | "p2" | "tie" | "double_loss" | null;
  source: string | null;
  p1Report: "win" | "loss" | null;
  p2Report: "win" | "loss" | null;
  p1Print: string | null;
  p2Print: string | null;
  judgeNote: string | null;
  room: string | null;
}

const STATUS: Record<AdminTable["status"], { label: string; cls: string }> = {
  bye: { label: "bye", cls: "bg-sky" },
  pending: { label: "sem reporte", cls: "bg-white" },
  one: { label: "1 reporte", cls: "bg-butter" },
  confirmed: { label: "confirmada", cls: "bg-bubble" },
  disputed: { label: "disputa", cls: "bg-red text-cream" },
};

const RESULT: Record<string, string> = { p1: "P1 venceu", p2: "P2 venceu", tie: "empate", double_loss: "derrota dupla" };
const SOURCE: Record<string, string> = { both: "os dois", auto: "por tempo", admin: "juiz", bye: "bye" };

export function TablesBoard({
  tournamentId,
  tables,
  stage,
  editable,
}: {
  tournamentId: string;
  tables: AdminTable[];
  stage: "swiss" | "topcut";
  editable: boolean;
}) {
  const [room, setRoom] = useState<{ name: string; label: string } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todas" | "pendentes">("todas");
  const shown = filter === "todas" ? tables : tables.filter((t) => t.status === "disputed" || t.status === "pending" || t.status === "one");
  const disputes = tables.filter((t) => t.status === "disputed").length;

  return (
    <div className={room ? "lg:pr-[440px]" : ""}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className={`btn btn-sm ${filter === "todas" ? "btn-primary" : "btn-light"}`} onClick={() => setFilter("todas")}>
          Todas ({tables.length})
        </button>
        <button type="button" className={`btn btn-sm ${filter === "pendentes" ? "btn-primary" : "btn-light"}`} onClick={() => setFilter("pendentes")}>
          Pendentes
        </button>
        {disputes ? <span className="chip border-cream bg-red text-cream">{disputes} disputa(s)</span> : null}
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((t) => (
          <li key={t.matchId} className={`card p-3 ${t.status === "disputed" ? "outline-4 outline-red" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-title text-xl">Mesa {t.table}</span>
              <span className={`chip ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {(["p1", "p2"] as const).map((side) => {
                const p = t[side];
                const rep = side === "p1" ? t.p1Report : t.p2Report;
                const print = side === "p1" ? t.p1Print : t.p2Print;
                return (
                  <div key={side} className={`rounded-xl border-2 border-navy p-2 ${t.result === side ? "bg-yellow" : "bg-white"}`}>
                    <p className="text-xs font-bold opacity-70">{side.toUpperCase()}</p>
                    <p className="truncate font-title">{p?.name ?? (side === "p2" ? "bye" : "?")}</p>
                    {p ? <p className="truncate text-xs opacity-75">{p.tcglive}</p> : null}
                    {rep ? <p className="mt-1 text-xs font-bold">diz: {rep === "win" ? "venci" : "perdi"}</p> : null}
                    {print ? (
                      <button type="button" onClick={() => setZoom(print)} className="mt-1 block w-full" aria-label={`Ver print de ${p?.name}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={print} alt="" className="h-20 w-full rounded-lg border-2 border-navy object-cover" loading="lazy" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {t.result ? (
              <p className="mt-2 text-sm">
                <b>{RESULT[t.result]}</b> {t.source ? `(${SOURCE[t.source] ?? t.source})` : ""}
                {t.judgeNote ? ` · ${t.judgeNote}` : ""}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {t.room && t.p2 ? (
                <button type="button" className="btn btn-neutral btn-sm" onClick={() => setRoom({ name: t.room!, label: `Mesa ${t.table}` })}>
                  Assistir
                </button>
              ) : null}
            </div>
            {editable && t.p2 ? (
              <details className="mt-2" open={t.status === "disputed"}>
                <summary className="cursor-pointer text-sm font-bold">Registrar resultado</summary>
                <ActionForm action={setResultAction} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={tournamentId} />
                  <input type="hidden" name="match" value={t.matchId} />
                  <input name="note" placeholder="Nota do juiz (opcional)" className="input py-1.5 text-sm" />
                  <div className="flex flex-wrap gap-1.5">
                    <SubmitButton className="btn btn-primary btn-sm" name="op" value="p1" pendingText="...">
                      {t.p1?.name.split(" ")[0]} venceu
                    </SubmitButton>
                    <SubmitButton className="btn btn-primary btn-sm" name="op" value="p2" pendingText="...">
                      {t.p2?.name.split(" ")[0]} venceu
                    </SubmitButton>
                    {stage === "swiss" ? (
                      <>
                        <SubmitButton className="btn btn-light btn-sm" name="op" value="tie" pendingText="...">
                          Empate
                        </SubmitButton>
                        <SubmitButton className="btn btn-light btn-sm" name="op" value="double_loss" pendingText="...">
                          Derrota dupla
                        </SubmitButton>
                      </>
                    ) : null}
                    <SubmitButton className="btn btn-danger btn-sm" name="op" value="penalty_p1" pendingText="..." confirm={`Penalidade: derrota para ${t.p1?.name}?`}>
                      Penalidade P1
                    </SubmitButton>
                    <SubmitButton className="btn btn-danger btn-sm" name="op" value="penalty_p2" pendingText="..." confirm={`Penalidade: derrota para ${t.p2?.name}?`}>
                      Penalidade P2
                    </SubmitButton>
                    {t.result ? (
                      <SubmitButton className="btn btn-light btn-sm" name="op" value="reopen" pendingText="..." confirm="Reverter esse resultado e mandar a mesa para disputa?">
                        Reverter
                      </SubmitButton>
                    ) : null}
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      {room ? (
        <aside className="fixed inset-x-0 bottom-0 z-40 h-[60dvh] border-t-4 border-cream bg-navy-deep p-3 lg:inset-y-0 lg:right-0 lg:left-auto lg:h-auto lg:w-[430px] lg:border-t-0 lg:border-l-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-title text-lg">Assistindo {room.label}</span>
            <div className="flex gap-2">
              <a className="btn btn-light btn-sm" href={`https://meet.jit.si/${room.name}`} target="_blank" rel="noreferrer">
                Nova aba
              </a>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setRoom(null)}>
                Fechar
              </button>
            </div>
          </div>
          <iframe
            key={room.name}
            title={`Sala ${room.label}`}
            src={jitsiUrl(room.name, "Juiz Mormaço")}
            allow="camera; microphone; display-capture; fullscreen; autoplay"
            className="h-[calc(100%-3rem)] w-full rounded-xl border-3 border-cream bg-black"
          />
        </aside>
      ) : null}

      {zoom ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/95 p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Print ampliado" className="max-h-full max-w-full rounded-xl border-4 border-cream" />
          <button type="button" className="btn btn-danger btn-sm absolute top-4 right-4">
            Fechar
          </button>
        </div>
      ) : null}
    </div>
  );
}
