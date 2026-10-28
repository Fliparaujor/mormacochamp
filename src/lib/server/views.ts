import type { Db } from "./db";
import type { MatchRow, PlayerRow, RoundRow, TournamentRow } from "./rows";
import {
  computePlacements,
  listEvents,
  loadState,
  participants,
  prizeTable,
  roundLabel,
  swissStandings,
  type TournamentState,
} from "./tournament";
import { nextPrizeBand, prizeBandFor, type PrizeBand } from "@/lib/engine/structure";
import { canReport, isResolved } from "@/lib/engine/results";
import { cutRoundLabel } from "@/lib/engine/topcut";
import { parseDecklist, type ParsedDeck } from "@/lib/engine/decklist";
import { eventText } from "@/lib/events-text";
import { effectivePixMode, latestPayment } from "./payments";

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface PublicTournament {
  id: string;
  slug: string;
  name: string;
  status: TournamentRow["status"];
  startsAt: string;
  checkinOpensAt: string | null;
  checkinClosesAt: string | null;
  roundMinutes: number;
  entryFeeCents: number;
  maxPlayers: number;
  minPlayers: number;
  whatsappGroupUrl: string | null;
  rulesUrl: string | null;
  isSimulation: boolean;
  nextRoundAt: string | null;
  swissRounds: number | null;
  topcutSize: number | null;
  autoMode: boolean;
  roomRequiredSwiss: boolean;
  roomRequiredTopcut: boolean;
}

export function publicTournament(t: TournamentRow): PublicTournament {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    startsAt: iso(t.starts_at)!,
    checkinOpensAt: iso(t.checkin_opens_at),
    checkinClosesAt: iso(t.checkin_closes_at),
    roundMinutes: t.round_minutes,
    entryFeeCents: t.entry_fee_cents,
    maxPlayers: t.max_players,
    minPlayers: t.min_players,
    whatsappGroupUrl: t.whatsapp_group_url,
    rulesUrl: t.rules_url,
    isSimulation: t.is_simulation,
    nextRoundAt: iso(t.next_round_at),
    swissRounds: t.swiss_rounds,
    topcutSize: t.topcut_size,
    autoMode: t.auto_mode,
    roomRequiredSwiss: t.room_required_swiss,
    roomRequiredTopcut: t.room_required_topcut,
  };
}

export type TableStatus = "bye" | "pending" | "one" | "confirmed" | "disputed";

export interface PlayerRef {
  id: string;
  name: string;
  tcglive: string;
}

export interface TableView {
  matchId: string;
  table: number;
  p1: PlayerRef | null;
  p2: PlayerRef | null;
  status: TableStatus;
  result: MatchRow["result"];
  source: MatchRow["result_source"];
}

export interface RoundView {
  id: string;
  number: number;
  stage: RoundRow["stage"];
  label: string;
  status: RoundRow["status"];
  startedAt: string | null;
  endsAt: string | null;
  closedAt: string | null;
  tables: TableView[];
}

export interface StandingView {
  rank: number;
  playerId: string;
  name: string;
  tcglive: string;
  points: number;
  wins: number;
  losses: number;
  ties: number;
  byes: number;
  owp: number;
  oowp: number;
  dropped: boolean;
}

export interface BracketMatchView {
  table: number;
  p1: string | null;
  p2: string | null;
  winner: "p1" | "p2" | null;
}

export interface BracketRoundView {
  label: string;
  matches: BracketMatchView[];
}

export interface PrizeView {
  basis: "pagos" | "check-in";
  players: number;
  band: PrizeBand | null;
  next: PrizeBand | null;
}

export interface FeedItem {
  id: number;
  type: string;
  text: string;
  at: string;
}

export interface PlacementView {
  place: number;
  playerId: string;
  name: string;
  tcglive: string;
  prizeCents: number;
}

export interface HubView {
  serverNow: string;
  t: PublicTournament;
  counts: { registered: number; paid: number; checkedIn: number; active: number };
  players: Array<{ name: string; tcglive: string; checkedIn: boolean; dropped: boolean }>;
  prize: PrizeView;
  round: RoundView | null;
  standings: StandingView[];
  bracket: BracketRoundView[];
  placements: PlacementView[];
  feed: FeedItem[];
}

function ref(p: PlayerRow | undefined): PlayerRef | null {
  return p ? { id: p.id, name: p.name, tcglive: p.tcglive_name } : null;
}

export function tableStatus(m: MatchRow): TableStatus {
  if (!m.p2_id) return "bye";
  if (m.disputed) return "disputed";
  if (isResolved(m)) return "confirmed";
  if (m.p1_report || m.p2_report) return "one";
  return "pending";
}

export function roundView(state: TournamentState, round: RoundRow): RoundView {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const ms = state.matches.filter((m) => m.round_id === round.id).sort((a, b) => a.table_number - b.table_number);
  return {
    id: round.id,
    number: round.number,
    stage: round.stage,
    label: roundLabel(round, ms.length),
    status: round.status,
    startedAt: iso(round.started_at),
    endsAt: iso(round.ends_at),
    closedAt: iso(round.closed_at),
    tables: ms.map((m) => ({
      matchId: m.id,
      table: m.table_number,
      p1: ref(byId.get(m.p1_id ?? "")),
      p2: ref(byId.get(m.p2_id ?? "")),
      status: tableStatus(m),
      result: m.disputed ? null : m.result,
      source: m.result_source,
    })),
  };
}

export function standingsView(state: TournamentState): StandingView[] {
  if (state.rounds.length === 0) return [];
  const byId = new Map(state.players.map((p) => [p.id, p]));
  return swissStandings(state).map((s) => ({
    rank: s.rank,
    playerId: s.playerId,
    name: byId.get(s.playerId)?.name ?? "?",
    tcglive: byId.get(s.playerId)?.tcglive_name ?? "",
    points: s.matchPoints,
    wins: s.wins,
    losses: s.losses,
    ties: s.ties,
    byes: s.byes,
    owp: s.owp,
    oowp: s.oowp,
    dropped: s.dropped,
  }));
}

export function bracketView(state: TournamentState): BracketRoundView[] {
  const size = state.t.topcut_size ?? 0;
  if (size < 2) return [];
  const byId = new Map(state.players.map((p) => [p.id, p.name]));
  const cutRounds = state.rounds.filter((r) => r.stage === "topcut");
  const out: BracketRoundView[] = [];
  let n = size;
  let i = 0;
  while (n >= 2) {
    const r = cutRounds[i];
    const count = n / 2;
    const label = cutRoundLabel(n);
    if (r) {
      const ms = state.matches.filter((m) => m.round_id === r.id).sort((a, b) => a.table_number - b.table_number);
      out.push({
        label,
        matches: ms.map((m) => ({
          table: m.table_number,
          p1: m.p1_id ? byId.get(m.p1_id) ?? null : null,
          p2: m.p2_id ? byId.get(m.p2_id) ?? null : null,
          winner: !m.disputed && (m.result === "p1" || m.result === "p2") ? m.result : null,
        })),
      });
    } else {
      out.push({
        label,
        matches: Array.from({ length: count }, (_, k) => ({ table: k + 1, p1: null, p2: null, winner: null })),
      });
    }
    n /= 2;
    i++;
  }
  return out;
}

export function prizeView(state: TournamentState): PrizeView {
  const beforeClose = ["draft", "registration", "checkin"].includes(state.t.status);
  const n = beforeClose
    ? state.players.filter((p) => p.payment_status === "paid").length
    : participants(state.players).length;
  const table = prizeTable(state.t);
  return { basis: beforeClose ? "pagos" : "check-in", players: n, band: prizeBandFor(n, table), next: nextPrizeBand(n, table) };
}

export async function feed(db: Db, tournamentId: string, admin = false, limit = 40): Promise<FeedItem[]> {
  const events = await listEvents(db, tournamentId, admin ? 300 : 120);
  const out: FeedItem[] = [];
  for (const e of events) {
    const text = eventText(e.type, e.payload ?? {}, admin);
    if (!text) continue;
    out.push({ id: e.id, type: e.type, text, at: iso(e.created_at)! });
    if (out.length >= limit) break;
  }
  return out;
}

function currentOrLastRound(state: TournamentState): RoundRow | null {
  return state.rounds.find((r) => r.status === "live") ?? state.rounds.at(-1) ?? null;
}

export async function hubViewFromState(db: Db, state: TournamentState): Promise<HubView> {
  const paid = state.players.filter((p) => p.payment_status === "paid");
  const parts = participants(state.players);
  const round = currentOrLastRound(state);
  return {
    serverNow: new Date().toISOString(),
    t: publicTournament(state.t),
    counts: {
      registered: state.players.length,
      paid: paid.length,
      checkedIn: paid.filter((p) => p.checked_in).length,
      active: parts.filter((p) => !p.dropped).length,
    },
    players: paid
      .filter((p) => !(p.dropped && p.drop_reason === "sem check-in"))
      .map((p) => ({ name: p.name, tcglive: p.tcglive_name, checkedIn: p.checked_in, dropped: p.dropped }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    prize: prizeView(state),
    round: round ? roundView(state, round) : null,
    standings: standingsView(state),
    bracket: bracketView(state),
    placements: state.t.status === "finished" ? computePlacements(state) : [],
    feed: await feed(db, state.t.id),
  };
}

export async function hubView(db: Db, tournamentId: string): Promise<HubView> {
  return hubViewFromState(db, await loadState(db, tournamentId));
}

// ───────────────────────── página pessoal ─────────────────────────

export interface MyMatchView {
  matchId: string;
  roundId: string;
  roundNumber: number;
  label: string;
  stage: RoundRow["stage"];
  table: number;
  startedAt: string | null;
  endsAt: string | null;
  opponent: PlayerRef | null;
  side: "p1" | "p2";
  myReport: "win" | "loss" | null;
  opponentReported: boolean;
  status: TableStatus;
  result: "win" | "loss" | "tie" | "double_loss" | null;
  source: MatchRow["result_source"];
  canReport: boolean;
  jitsiRoom: string | null;
  roomRequired: boolean;
}

export interface PlayerView {
  hub: HubView;
  me: {
    id: string;
    name: string;
    tcglive: string;
    whatsapp: string;
    paymentStatus: PlayerRow["payment_status"];
    checkedIn: boolean;
    dropped: boolean;
    dropReason: string | null;
    decklist: string;
    decklistLocked: boolean;
    deck: Pick<ParsedDeck, "total" | "ok" | "warnings">;
  };
  match: MyMatchView | null;
  standing: StandingView | null;
  placement: PlacementView | null;
  payment: {
    mode: "manual" | "mercadopago";
    pixKey: string | null;
    amountCents: number;
    qrCode: string | null;
    qrBase64: string | null;
  };
}

export async function playerView(db: Db, player: PlayerRow): Promise<PlayerView> {
  const state = await loadState(db, player.tournament_id);
  const hub = await hubViewFromState(db, state);
  const live = state.rounds.find((r) => r.status === "live");
  let match: MyMatchView | null = null;
  const lastRound = live ?? state.rounds.at(-1);
  if (lastRound) {
    const ms = state.matches.filter((m) => m.round_id === lastRound.id);
    const m = ms.find((x) => x.p1_id === player.id || x.p2_id === player.id);
    if (m) {
      const side = m.p1_id === player.id ? "p1" : "p2";
      const oppId = side === "p1" ? m.p2_id : m.p1_id;
      const opp = state.players.find((p) => p.id === oppId);
      const resolved = isResolved(m);
      let result: MyMatchView["result"] = null;
      if (resolved) {
        if (m.result === "tie" || m.result === "double_loss") result = m.result;
        else result = m.result === side ? "win" : "loss";
      }
      match = {
        matchId: m.id,
        roundId: lastRound.id,
        roundNumber: lastRound.number,
        label: roundLabel(lastRound, ms.length),
        stage: lastRound.stage,
        table: m.table_number,
        startedAt: iso(lastRound.started_at),
        endsAt: iso(lastRound.ends_at),
        opponent: ref(opp),
        side,
        myReport: side === "p1" ? m.p1_report : m.p2_report,
        opponentReported: Boolean(side === "p1" ? m.p2_report : m.p1_report),
        status: tableStatus(m),
        result,
        source: m.result_source,
        canReport:
          lastRound.status === "live" &&
          canReport(
            { p2: m.p2_id, p1Report: m.p1_report, p2Report: m.p2_report, result: m.result, disputed: m.disputed },
            new Date(),
            lastRound.ends_at,
          ),
        jitsiRoom: m.jitsi_room,
        roomRequired: lastRound.stage === "topcut" ? state.t.room_required_topcut : state.t.room_required_swiss,
      };
    }
  }
  const deck = parseDecklist(player.decklist_text);
  const pay = await latestPayment(db, player.id);
  return {
    hub,
    me: {
      id: player.id,
      name: player.name,
      tcglive: player.tcglive_name,
      whatsapp: player.whatsapp,
      paymentStatus: player.payment_status,
      checkedIn: player.checked_in,
      dropped: player.dropped,
      dropReason: player.drop_reason,
      decklist: player.decklist_text ?? "",
      decklistLocked: player.decklist_locked,
      deck: { total: deck.total, ok: deck.ok, warnings: deck.warnings },
    },
    match,
    standing: hub.standings.find((s) => s.playerId === player.id) ?? null,
    placement: hub.placements.find((p) => p.playerId === player.id) ?? null,
    payment: {
      mode: effectivePixMode(state.t),
      pixKey: state.t.pix_key,
      amountCents: state.t.entry_fee_cents,
      qrCode: pay?.provider === "mercadopago" && pay.status === "pending" ? pay.qr_code : null,
      qrBase64: pay?.provider === "mercadopago" && pay.status === "pending" ? pay.qr_base64 : null,
    },
  };
}

/** Texto pronto para colar no grupo do WhatsApp. */
export function pairingsText(round: RoundView, minutes: number): string {
  const lines = [`${round.label} · ${minutes} min · até ${fmtHourLocal(round.endsAt)}`];
  for (const t of round.tables) {
    const name = (p: PlayerRef | null) => (p ? p.name : "?");
    if (!t.p2) lines.push(`Mesa ${t.table}: ${name(t.p1)} · bye`);
    else lines.push(`Mesa ${t.table}: ${name(t.p1)} × ${name(t.p2)}`);
  }
  return lines.join("\n");
}

function fmtHourLocal(d: string | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" })
    .format(new Date(d))
    .replace(":", "h");
}
