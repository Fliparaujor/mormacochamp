import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { requireAdminPage } from "@/lib/server/auth";
import { loadState, participants } from "@/lib/server/tournament";
import { feed, hubViewFromState, pairingsText, roundView } from "@/lib/server/views";
import { printUrl } from "@/lib/server/storage";
import { mpEnabled, effectivePixMode } from "@/lib/server/payments";
import { parseDecklist } from "@/lib/engine/decklist";
import { Header, Page } from "@/components/brand";
import { Bracket, Feed, Pairings, Section, Standings, StatusBadge } from "@/components/tournament";
import { ActionForm, CopyButton, SubmitButton } from "@/components/ui";
import { Countdown, LiveUpdater } from "@/components/live";
import { deadlinesOf } from "@/components/hub-parts";
import { TablesBoard, type AdminTable } from "@/components/admin/tables-board";
import { TournamentForm } from "@/components/admin/tournament-form";
import {
  adjustTimeAction,
  checkinPlayerAction,
  confirmPixAction,
  deleteSimulationAction,
  dropAction,
  editDeckAction,
  editPlayerAction,
  manualByeAction,
  openRoundAction,
  refundAction,
  setStatusAction,
  tickNowAction,
  toggleAutoAction,
  undoRoundAction,
} from "@/app/actions/admin";
import { fmtDateTime, fmtMoney, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · torneio", robots: { index: false } };

const TABS = [
  ["geral", "Geral"],
  ["inscritos", "Inscritos"],
  ["mesas", "Mesas"],
  ["classificacao", "Classificação"],
  ["eventos", "Eventos"],
  ["config", "Configurar"],
] as const;

type Tab = (typeof TABS)[number][0];

export default async function AdminTournament({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; r?: string; f?: string; criado?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const state = await loadState(db, id).catch(() => null);
  if (!state) notFound();
  const { t } = state;
  const hub = await hubViewFromState(db, state);
  const tab: Tab = (TABS.find(([k]) => k === sp.aba)?.[0] ?? "geral") as Tab;
  const live = state.rounds.find((r) => r.status === "live") ?? null;
  const base = `/admin/t/${id}`;

  return (
    <Page wide>
      <LiveUpdater tournamentId={id} deadlines={deadlinesOf(hub)} pollMs={t.is_simulation ? 4000 : 10000} active={!["finished", "cancelled"].includes(t.status)} />
      <Header right={<Link href="/admin" className="btn btn-light btn-sm">Todos</Link>} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={t.status} />
        {t.is_simulation ? <span className="chip border-cream bg-red text-cream">simulação</span> : null}
        <span className={`chip ${t.auto_mode ? "bg-bubble text-navy" : "bg-cream/20 text-cream border-cream"}`}>auto {t.auto_mode ? "ligado" : "desligado"}</span>
      </div>
      <h1 className="font-title mt-2 text-3xl sm:text-4xl">{t.name}</h1>
      <p className="text-cream/80">
        {fmtDateTime(t.starts_at)} ·{" "}
        <Link href={`/t/${t.slug}`} className="link" target="_blank">
          /t/{t.slug}
        </Link>{" "}
        ·{" "}
        <Link href={`/t/${t.slug}/display`} className="link" target="_blank">
          telão
        </Link>
      </p>
      {sp.criado ? <p className="chip mt-2 bg-yellow text-navy">Torneio criado. Confira os campos abaixo.</p> : null}

      <nav className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`${base}?aba=${k}`} className={`btn btn-sm shrink-0 ${tab === k ? "btn-primary" : "btn-light"}`}>
            {label}
            {k === "mesas" && live ? ` · R${live.number}` : ""}
          </Link>
        ))}
      </nav>

      <div className="mt-4 space-y-5">
        {tab === "geral" ? <GeralTab state={state} hub={hub} /> : null}
        {tab === "inscritos" ? <InscritosTab state={state} filter={sp.f ?? "todos"} base={base} /> : null}
        {tab === "mesas" ? <MesasTab state={state} roundParam={sp.r} base={base} /> : null}
        {tab === "classificacao" ? (
          <>
            {hub.bracket.length ? (
              <Section title="Chave">
                <Bracket rounds={hub.bracket} />
              </Section>
            ) : null}
            <Section title="Classificação do suíço">
              <Standings rows={hub.standings} />
            </Section>
            {hub.placements.length ? (
              <Section title="Colocação final e prêmios">
                <ol className="space-y-1">
                  {hub.placements.map((p) => (
                    <li key={p.playerId} className="flex justify-between">
                      <span>
                        <b>{p.place}º</b> {p.name} <span className="opacity-60">({p.tcglive})</span>
                      </span>
                      {p.prizeCents ? <b>{fmtMoney(p.prizeCents)}</b> : null}
                    </li>
                  ))}
                </ol>
              </Section>
            ) : null}
          </>
        ) : null}
        {tab === "eventos" ? (
          <Section
            title={
              <span className="flex flex-wrap items-center gap-2">
                Log de eventos
                <a href={`/api/admin/export/${id}?tipo=eventos`} className="btn btn-light btn-sm">
                  Exportar CSV
                </a>
                <a href={`/api/admin/export/${id}?tipo=inscritos`} className="btn btn-light btn-sm">
                  Inscritos CSV
                </a>
              </span>
            }
          >
            <Feed items={await feed(db, id, true, 300)} />
          </Section>
        ) : null}
        {tab === "config" ? (
          <Section title="Configurar torneio">
            <TournamentForm t={t} mpAvailable={mpEnabled()} />
          </Section>
        ) : null}
      </div>
    </Page>
  );
}

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="id" value={id} />;
}

async function GeralTab({ state, hub }: { state: Awaited<ReturnType<typeof loadState>>; hub: Awaited<ReturnType<typeof hubViewFromState>> }) {
  const { t } = state;
  const live = state.rounds.find((r) => r.status === "live") ?? null;
  const liveView = live ? roundView(state, live) : null;
  const disputes = liveView?.tables.filter((x) => x.status === "disputed").length ?? 0;
  const pendingPix = state.players.filter((p) => p.payment_status === "pending").length;
  const id = t.id;
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Números" tone="card-butter">
          <ul className="space-y-1 text-lg">
            <li>
              Inscritos: <b>{hub.counts.registered}</b>
            </li>
            <li>
              Pagos: <b>{hub.counts.paid}</b> {pendingPix ? <span className="chip bg-white">{pendingPix} aguardando Pix</span> : null}
            </li>
            <li>
              Check-in: <b>{hub.counts.checkedIn}</b>
            </li>
            <li>
              Ativos: <b>{hub.counts.active}</b>
            </li>
            <li>
              Estrutura: <b>{t.swiss_rounds ?? "auto"}</b> rodadas · top <b>{t.topcut_size ?? "auto"}</b>
            </li>
            <li>Pix: {effectivePixMode(t) === "mercadopago" ? "Mercado Pago" : "manual"}</li>
          </ul>
        </Section>

        <Section title="Automático">
          <p className="text-sm">
            Ligado: abre e fecha check-in no horário, dropa quem não veio, pareia, confirma por tempo, abre a próxima rodada {t.auto_next_round_delay_seconds}s depois, gera top cut e encerra.
          </p>
          <ActionForm action={toggleAutoAction} className="mt-3 flex flex-wrap gap-2">
            <Hidden id={id} />
            <input type="hidden" name="on" value={t.auto_mode ? "0" : "1"} />
            <SubmitButton className={`btn ${t.auto_mode ? "btn-danger" : "btn-primary"}`}>{t.auto_mode ? "Desligar automático" : "Ligar automático"}</SubmitButton>
          </ActionForm>
          <ActionForm action={tickNowAction} className="mt-2">
            <Hidden id={id} />
            <SubmitButton className="btn btn-light btn-sm" pendingText="Rodando...">
              Rodar automatismos agora
            </SubmitButton>
          </ActionForm>
        </Section>

        <Section title="Fluxo">
          <div className="flex flex-wrap gap-2">
            {[
              ["registration", "Abrir inscrições", "btn-light", ["draft", "cancelled"]],
              ["checkin_open", "Abrir check-in", "btn-primary", ["draft", "registration"]],
              ["checkin_close", "Fechar check-in e parear", "btn-primary", ["checkin", "registration"]],
              ["cancel", "Cancelar torneio", "btn-danger", ["draft", "registration", "checkin", "swiss", "topcut"]],
            ]
              .filter(([, , , allowed]) => (allowed as string[]).includes(t.status))
              .map(([op, label, cls]) => (
                <ActionForm key={op as string} action={setStatusAction}>
                  <Hidden id={id} />
                  <input type="hidden" name="op" value={op as string} />
                  <SubmitButton
                    className={`btn btn-sm ${cls}`}
                    confirm={op === "cancel" ? "Cancelar o torneio? Se o Pix for Mercado Pago, devolve automático." : op === "checkin_close" ? "Fechar o check-in agora? Quem não fez fica fora." : undefined}
                  >
                    {label as string}
                  </SubmitButton>
                </ActionForm>
              ))}
          </div>
          {t.checkin_opens_at ? (
            <p className="mt-3 text-sm">
              Check-in: {fmtTime(t.checkin_opens_at)} às {fmtTime(t.checkin_closes_at)}
            </p>
          ) : null}
          {t.is_simulation ? (
            <ActionForm action={deleteSimulationAction} className="mt-3">
              <Hidden id={id} />
              <SubmitButton className="btn btn-danger btn-sm" confirm="Apagar essa simulação?">
                Apagar simulação
              </SubmitButton>
            </ActionForm>
          ) : null}
        </Section>
      </div>

      <Section
        tone="card-butter"
        title={
          live ? (
            <span className="flex flex-wrap items-center gap-3">
              {liveView!.label} ao vivo
              {live.ends_at ? <Countdown to={live.ends_at.toISOString()} serverNow={hub.serverNow} expired={<span className="text-red">tempo acabou</span>} /> : null}
              {disputes ? <span className="chip bg-red text-cream">{disputes} disputa(s)</span> : null}
            </span>
          ) : (
            "Rodadas"
          )
        }
      >
        {t.next_round_at ? (
          <p className="mb-3 text-lg">
            Próxima rodada em <Countdown to={t.next_round_at.toISOString()} serverNow={hub.serverNow} className="font-title" /> ({fmtTime(t.next_round_at)})
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!live && (t.status === "swiss" || t.status === "topcut") ? (
            <ActionForm action={openRoundAction}>
              <Hidden id={id} />
              <SubmitButton pendingText="Pareando...">Abrir próxima rodada agora</SubmitButton>
            </ActionForm>
          ) : null}
          {live ? (
            <>
              {[-5, 1, 5].map((m) => (
                <ActionForm key={m} action={adjustTimeAction}>
                  <Hidden id={id} />
                  <input type="hidden" name="round" value={live.id} />
                  <input type="hidden" name="minutes" value={m} />
                  <SubmitButton className="btn btn-light btn-sm">{m > 0 ? `+${m}` : m} min</SubmitButton>
                </ActionForm>
              ))}
              <ActionForm action={undoRoundAction}>
                <Hidden id={id} />
                <input type="hidden" name="reopen" value="1" />
                <SubmitButton className="btn btn-light btn-sm" confirm="Re-parear apaga as mesas e reportes desta rodada e gera de novo. Continuar?">
                  Re-parear
                </SubmitButton>
              </ActionForm>
              <ActionForm action={undoRoundAction}>
                <Hidden id={id} />
                <input type="hidden" name="reopen" value="0" />
                <SubmitButton className="btn btn-danger btn-sm" confirm="Desfazer a rodada (apagar mesas e reportes)?">
                  Desfazer rodada
                </SubmitButton>
              </ActionForm>
              <Link href={`/admin/t/${id}?aba=mesas`} className="btn btn-neutral btn-sm">
                Ver mesas
              </Link>
            </>
          ) : null}
        </div>
        {liveView ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={pairingsText(liveView, t.round_minutes)} label="Copiar pareamentos pro WhatsApp" className="btn btn-primary btn-sm" />
            </div>
            <pre className="overflow-x-auto rounded-xl border-2 border-navy bg-white p-3 text-xs whitespace-pre-wrap">{pairingsText(liveView, t.round_minutes)}</pre>
            <Pairings round={liveView} />
          </div>
        ) : null}
      </Section>

      <Section title="Últimos eventos" tone="card-dark">
        <Feed items={(await feed(getDb(), id, true, 15))} />
      </Section>
    </>
  );
}

function InscritosTab({ state, filter, base }: { state: Awaited<ReturnType<typeof loadState>>; filter: string; base: string }) {
  const filters: Array<[string, string, (p: (typeof state.players)[number]) => boolean]> = [
    ["todos", "Todos", () => true],
    ["pendentes", "Aguardando Pix", (p) => p.payment_status === "pending"],
    ["pagos", "Pagos", (p) => p.payment_status === "paid"],
    ["checkin", "Com check-in", (p) => p.checked_in],
    ["semcheckin", "Pagos sem check-in", (p) => p.payment_status === "paid" && !p.checked_in],
    ["drop", "Fora", (p) => p.dropped],
  ];
  const f = filters.find(([k]) => k === filter) ?? filters[0];
  const rows = state.players.filter(f[2]);
  const started = state.rounds.length > 0;
  return (
    <Section
      title={
        <span className="flex flex-wrap gap-2">
          {filters.map(([k, label, fn]) => (
            <Link key={k} href={`${base}?aba=inscritos&f=${k}`} className={`btn btn-sm ${k === f[0] ? "btn-primary" : "btn-light"}`}>
              {label} ({state.players.filter(fn).length})
            </Link>
          ))}
        </span>
      }
    >
      <ul className="divide-y-2 divide-navy/15">
        {rows.map((p) => {
          const deck = parseDecklist(p.decklist_text);
          return (
            <li key={p.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-title text-lg">{p.name}</span>
                <span className="font-mono text-sm opacity-75">{p.tcglive_name}</span>
                <span className={`chip ${p.payment_status === "paid" ? "bg-bubble" : p.payment_status === "refunded" ? "bg-cream" : "bg-butter"}`}>
                  {p.payment_status === "paid" ? "pago" : p.payment_status === "refunded" ? "devolvido" : "aguardando Pix"}
                </span>
                {p.checked_in ? <span className="chip bg-yellow">check-in</span> : null}
                {p.dropped ? <span className="chip bg-red text-cream">fora · {p.drop_reason}</span> : null}
                <span className={`chip ${deck.ok ? "bg-white" : "bg-red/20"}`}>{deck.total} cartas</span>
                {p.seed ? <span className="chip bg-white">seed {p.seed}</span> : null}
                {p.is_bot ? <span className="chip bg-white">bot</span> : null}
              </div>
              <p className="mt-1 text-sm">
                <a className="link" href={`https://wa.me/${p.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")}`} target="_blank" rel="noreferrer">
                  {p.whatsapp}
                </a>
                {p.email ? ` · ${p.email}` : ""} · inscrito {fmtDateTime(p.created_at)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.payment_status === "pending" ? (
                  <ActionForm action={confirmPixAction}>
                    <input type="hidden" name="player" value={p.id} />
                    <SubmitButton className="btn btn-primary btn-sm">Confirmar Pix</SubmitButton>
                  </ActionForm>
                ) : null}
                {p.payment_status === "paid" ? (
                  <ActionForm action={refundAction}>
                    <input type="hidden" name="player" value={p.id} />
                    <SubmitButton className="btn btn-light btn-sm" confirm={`Marcar o Pix de ${p.name} como devolvido?`}>
                      Devolver
                    </SubmitButton>
                  </ActionForm>
                ) : null}
                {p.payment_status === "paid" && !started ? (
                  <ActionForm action={checkinPlayerAction}>
                    <input type="hidden" name="player" value={p.id} />
                    <input type="hidden" name="on" value={p.checked_in ? "0" : "1"} />
                    <SubmitButton className="btn btn-light btn-sm">{p.checked_in ? "Desfazer check-in" : "Fazer check-in"}</SubmitButton>
                  </ActionForm>
                ) : null}
                <ActionForm action={dropAction}>
                  <input type="hidden" name="player" value={p.id} />
                  <input type="hidden" name="dropped" value={p.dropped ? "0" : "1"} />
                  <SubmitButton className={`btn btn-sm ${p.dropped ? "btn-light" : "btn-danger"}`} confirm={p.dropped ? undefined : `Dropar ${p.name}?`}>
                    {p.dropped ? "Voltar ao torneio" : "Dropar"}
                  </SubmitButton>
                </ActionForm>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-bold">Lista e dados</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <ActionForm action={editDeckAction} className="space-y-2">
                    <input type="hidden" name="player" value={p.id} />
                    <textarea name="decklist" rows={10} defaultValue={p.decklist_text ?? ""} className="input font-mono text-xs" />
                    {deck.warnings.length ? <p className="text-xs">{deck.warnings.join(" ")}</p> : null}
                    <SubmitButton className="btn btn-light btn-sm">Salvar lista</SubmitButton>
                  </ActionForm>
                  <ActionForm action={editPlayerAction} className="space-y-2">
                    <input type="hidden" name="player" value={p.id} />
                    <input name="name" defaultValue={p.name} className="input" />
                    <input name="tcglive" defaultValue={p.tcglive_name} className="input" />
                    <input name="whatsapp" defaultValue={p.whatsapp} className="input" />
                    <SubmitButton className="btn btn-light btn-sm">Salvar dados</SubmitButton>
                  </ActionForm>
                </div>
              </details>
            </li>
          );
        })}
        {!rows.length ? <li className="py-3">Ninguém nesse filtro.</li> : null}
      </ul>
    </Section>
  );
}

async function MesasTab({ state, roundParam, base }: { state: Awaited<ReturnType<typeof loadState>>; roundParam?: string; base: string }) {
  const { t } = state;
  if (!state.rounds.length) return <Section><p>Nenhuma rodada ainda.</p></Section>;
  const live = state.rounds.find((r) => r.status === "live");
  const selected = state.rounds.find((r) => String(r.number) === roundParam) ?? live ?? state.rounds.at(-1)!;
  const view = roundView(state, selected);
  const ms = state.matches.filter((m) => m.round_id === selected.id).sort((a, b) => a.table_number - b.table_number);
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const tables: AdminTable[] = await Promise.all(
    ms.map(async (m) => {
      const tv = view.tables.find((x) => x.matchId === m.id)!;
      const p1 = byId.get(m.p1_id ?? "");
      const p2 = byId.get(m.p2_id ?? "");
      return {
        matchId: m.id,
        table: m.table_number,
        p1: p1 ? { id: p1.id, name: p1.name, tcglive: p1.tcglive_name } : null,
        p2: p2 ? { id: p2.id, name: p2.name, tcglive: p2.tcglive_name } : null,
        status: tv.status,
        result: m.result,
        source: m.result_source,
        p1Report: m.p1_report,
        p2Report: m.p2_report,
        p1Print: await printUrl(m.p1_print_url),
        p2Print: await printUrl(m.p2_print_url),
        judgeNote: m.judge_note,
        room: m.jitsi_room,
      };
    }),
  );
  const later = state.rounds.some((r) => r.number > selected.number);
  const editable = !(selected.stage === "topcut" && later);
  const inRound = new Set(ms.flatMap((m) => [m.p1_id, m.p2_id]));
  const unpaired = participants(state.players).filter((p) => !p.dropped && !inRound.has(p.id));
  return (
    <>
      <nav className="flex flex-wrap gap-2">
        {state.rounds.map((r) => (
          <Link key={r.id} href={`${base}?aba=mesas&r=${r.number}`} className={`btn btn-sm ${r.id === selected.id ? "btn-primary" : "btn-light"}`}>
            {r.stage === "swiss" ? `R${r.number}` : roundView(state, r).label}
            {r.status === "live" ? " · ao vivo" : ""}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-title text-2xl">{view.label}</h2>
        <span className="chip border-cream text-cream">{selected.status === "live" ? "ao vivo" : selected.status === "closed" ? "encerrada" : "pendente"}</span>
        {selected.ends_at ? <span className="text-sm text-cream/80">até {fmtTime(selected.ends_at)}</span> : null}
        <CopyButton text={pairingsText(view, t.round_minutes)} label="Copiar pareamentos" className="btn btn-primary btn-sm" />
      </div>
      <TablesBoard tournamentId={t.id} tables={tables} stage={selected.stage} editable={editable} />
      {selected.status === "live" && unpaired.length ? (
        <Section title="Bye manual">
          <p className="mb-2 text-sm">Jogadores ativos sem mesa nesta rodada:</p>
          <div className="flex flex-wrap gap-2">
            {unpaired.map((p) => (
              <ActionForm key={p.id} action={manualByeAction}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="player" value={p.id} />
                <SubmitButton className="btn btn-light btn-sm">Bye para {p.name}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
