"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/server/db";
import { AuthError, safe, str, type ActionResult } from "@/lib/server/action-utils";
import { checkPassword, createAdminSession, destroyAdminSession, isAdmin } from "@/lib/server/auth";
import {
  adminAdjustTime,
  adminDropPlayer,
  adminManualBye,
  adminOpenNextRound,
  adminPenalty,
  adminReopenMatch,
  adminSetCheckin,
  adminSetResult,
  adminUndoRound,
  closeCheckin,
  confirmPayment,
  getTournament,
  lockTournament,
  logEvent,
  markRefunded,
  openCheckin,
  UserError,
} from "@/lib/server/tournament";
import { saveDecklist } from "@/lib/server/registration";
import { createSimulation } from "@/lib/server/simulation";
import { refundAll, refundPlayer, mpEnabled } from "@/lib/server/payments";
import { zonedLocalToUtc } from "@/lib/format";
import { DEFAULT_RULES_MD } from "@/lib/rules";
import { DEFAULT_PRIZE_TABLE } from "@/lib/engine/structure";
import type { PlayerRow, TournamentRow } from "@/lib/server/rows";
import { runTournamentTick } from "@/lib/server/automation";

async function guard() {
  if (!(await isAdmin())) throw new AuthError("Sessão de admin expirada. Entre de novo.");
}

function done(tournamentId?: string) {
  if (tournamentId) revalidatePath(`/admin/t/${tournamentId}`);
  revalidatePath("/", "layout");
}

const uuid = z.string().uuid("Identificador inválido.");

// ───────────── login ─────────────

export async function loginAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!process.env.ADMIN_PASSWORD) return { ok: false, error: "ADMIN_PASSWORD não configurada no servidor." };
  if (!checkPassword(str(fd, "password"))) {
    await new Promise((r) => setTimeout(r, 600));
    return { ok: false, error: "Senha errada." };
  }
  await createAdminSession();
  redirect("/admin");
}

export async function logoutAction() {
  await destroyAdminSession();
  redirect("/admin/login");
}

// ───────────── torneio ─────────────

const optInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), `Use um número entre ${min} e ${max}.`);

const reqInt = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, `${label}: use um número entre ${min} e ${max}.`);

const tournamentSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, "Slug: só letras minúsculas, números e hífen."),
  name: z.string().trim().min(3, "Nome muito curto.").max(80),
  starts_at: z.string().min(16, "Data de início obrigatória."),
  timezone: z.string().trim().min(3).default("America/Fortaleza"),
  format: z.string().trim().default("standard"),
  best_of: reqInt(1, 3, "Melhor de"),
  round_minutes: reqInt(1, 120, "Minutos por rodada"),
  min_players: reqInt(2, 256, "Mínimo de jogadores"),
  max_players: reqInt(2, 256, "Máximo de jogadores"),
  entry_fee: z
    .string()
    .trim()
    .transform((v) => Math.round(Number(v.replace(",", ".")) * 100))
    .refine((v) => Number.isFinite(v) && v >= 0, "Valor da inscrição inválido."),
  pix_key: z.string().trim().max(120),
  pix_mode: z.enum(["manual", "mercadopago"]),
  status: z.enum(["draft", "registration", "checkin", "swiss", "topcut", "finished", "cancelled"]),
  checkin_opens_at: z.string(),
  checkin_closes_at: z.string(),
  auto_mode: z.string().optional(),
  auto_next_round_delay_seconds: reqInt(0, 3600, "Intervalo entre rodadas"),
  swiss_rounds: optInt(1, 12),
  topcut_size: optInt(0, 16),
  rules_url: z.string().trim().max(300),
  rules_md: z.string().max(20000),
  whatsapp_group_url: z.string().trim().max(300),
  prize_table: z.string().max(5000),
  room_required_topcut: z.string().optional(),
  room_required_swiss: z.string().optional(),
});

function parsePrizeTable(raw: string) {
  if (!raw.trim()) return DEFAULT_PRIZE_TABLE;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new UserError("Tabela de prêmio: JSON inválido.");
  }
  const schema = z.array(
    z.object({ min: z.number().int().min(1), max: z.number().int().min(1), prizes: z.array(z.number().int().min(0)) }),
  );
  const r = schema.safeParse(data);
  if (!r.success) throw new UserError('Tabela de prêmio: use [{"min":8,"max":11,"prizes":[7000,4000]}] (valores em centavos).');
  return r.data;
}

function readTournament(fd: FormData) {
  const keys = Object.keys(tournamentSchema.shape);
  const raw: Record<string, string> = {};
  for (const k of keys) {
    const v = fd.get(k);
    if (typeof v === "string") raw[k] = v;
  }
  const v = tournamentSchema.parse(raw);
  const tz = v.timezone || "America/Fortaleza";
  const toUtc = (s: string) => (s ? zonedLocalToUtc(s, tz) : null);
  const startsAt = toUtc(v.starts_at)!;
  const opens = toUtc(v.checkin_opens_at);
  const closes = toUtc(v.checkin_closes_at);
  if (opens && closes && closes <= opens) throw new UserError("O check-in precisa fechar depois de abrir.");
  if (v.min_players > v.max_players) throw new UserError("Mínimo de jogadores maior que o máximo.");
  return {
    ...v,
    timezone: tz,
    starts_at: startsAt,
    checkin_opens_at: opens,
    checkin_closes_at: closes,
    auto_mode: v.auto_mode === "on",
    room_required_topcut: v.room_required_topcut === "on",
    room_required_swiss: v.room_required_swiss === "on",
    prize_table: parsePrizeTable(v.prize_table),
    rules_md: v.rules_md.trim() || DEFAULT_RULES_MD,
  };
}

const COLS = [
  "slug",
  "name",
  "starts_at",
  "timezone",
  "format",
  "best_of",
  "round_minutes",
  "min_players",
  "max_players",
  "entry_fee_cents",
  "pix_key",
  "pix_mode",
  "status",
  "checkin_opens_at",
  "checkin_closes_at",
  "auto_mode",
  "auto_next_round_delay_seconds",
  "swiss_rounds",
  "topcut_size",
  "rules_url",
  "rules_md",
  "whatsapp_group_url",
  "prize_table",
  "room_required_topcut",
  "room_required_swiss",
] as const;

function values(v: ReturnType<typeof readTournament>) {
  const row: Record<(typeof COLS)[number], unknown> = {
    ...v,
    entry_fee_cents: v.entry_fee,
    pix_key: v.pix_key || null,
    rules_url: v.rules_url || null,
    whatsapp_group_url: v.whatsapp_group_url || null,
    prize_table: JSON.stringify(v.prize_table),
  } as any;
  return COLS.map((c) => row[c]);
}

export async function createTournamentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const res = await safe(async () => {
    await guard();
    const v = readTournament(fd);
    const db = getDb();
    const exists = await db.query("select 1 from tournaments where slug = $1", [v.slug]);
    if (exists.length) throw new UserError("Já existe um torneio com esse slug.");
    const placeholders = COLS.map((_, i) => `$${i + 1}`).join(",");
    const [t] = await db.query<{ id: string }>(
      `insert into tournaments (${COLS.join(",")}) values (${placeholders}) returning id`,
      values(v),
    );
    await logEvent(db, t.id, "tournament_created", { name: v.name });
    id = t.id;
  });
  if (id) redirect(`/admin/t/${id}?aba=config&criado=1`);
  return res;
}

export async function updateTournamentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const v = readTournament(fd);
    const db = getDb();
    await db.tx(async (tx) => {
      await lockTournament(tx, id);
      const cur = await getTournament(tx, id);
      if (!cur) throw new UserError("Torneio não encontrado.");
      const dupe = await tx.query("select 1 from tournaments where slug = $1 and id <> $2", [v.slug, id]);
      if (dupe.length) throw new UserError("Já existe outro torneio com esse slug.");
      const [{ n }] = await tx.query<{ n: number }>("select count(*)::int as n from rounds where tournament_id = $1", [id]);
      if (n > 0 && (v.swiss_rounds !== cur.swiss_rounds || v.topcut_size !== cur.topcut_size)) {
        // Depois da rodada 1 só dá para aumentar/reduzir rodadas restantes, nunca mudar o corte já iniciado.
        const [{ cut }] = await tx.query<{ cut: number }>(
          "select count(*)::int as cut from rounds where tournament_id = $1 and stage = 'topcut'",
          [id],
        );
        if (cut > 0 && v.topcut_size !== cur.topcut_size) throw new UserError("O top cut já começou; o tamanho do corte não muda mais.");
      }
      const sets = COLS.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await tx.query(`update tournaments set ${sets} where id = $1`, [id, ...values(v)]);
      await logEvent(tx, id, "tournament_updated", {});
      if (cur.auto_mode !== v.auto_mode) await logEvent(tx, id, "auto_mode", { on: v.auto_mode });
      if (cur.status !== v.status) await logEvent(tx, id, "status_changed", { status: v.status, from: cur.status });
    });
    done(id);
    return "Torneio salvo.";
  });
}

export async function toggleAutoAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const on = str(fd, "on") === "1";
    const db = getDb();
    await db.tx(async (tx) => {
      await lockTournament(tx, id);
      await tx.query("update tournaments set auto_mode = $2 where id = $1", [id, on]);
      if (!on) await tx.query("update tournaments set next_round_at = null where id = $1", [id]);
      await logEvent(tx, id, "auto_mode", { on });
    });
    if (on) await runTournamentTick(db, id, true);
    done(id);
  });
}

export async function setStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const op = z.enum(["registration", "checkin_open", "checkin_close", "cancel", "draft", "finish"]).parse(str(fd, "op"));
    const db = getDb();
    let refunds: string[] = [];
    await db.tx(async (tx) => {
      await lockTournament(tx, id);
      const t = (await getTournament(tx, id)) as TournamentRow;
      if (op === "registration" || op === "draft") {
        if (!["draft", "registration", "cancelled", "checkin"].includes(t.status)) throw new UserError("O torneio já começou.");
        await tx.query("update tournaments set status = $2 where id = $1", [id, op]);
        await logEvent(tx, id, "status_changed", { status: op, from: t.status });
      } else if (op === "checkin_open") {
        await openCheckin(tx, t, "admin");
      } else if (op === "checkin_close") {
        const r = await closeCheckin(tx, t, new Date(), "admin");
        refunds = r.refundPlayerIds;
      } else if (op === "cancel") {
        await tx.query("update tournaments set status = 'cancelled', next_round_at = null where id = $1", [id]);
        await logEvent(tx, id, "cancelled", { reason: "admin", by: "admin" });
        refunds = (await tx.query<{ id: string }>("select id from players where tournament_id = $1 and payment_status = 'paid'", [id])).map((p) => p.id);
      } else if (op === "finish") {
        await tx.query("update tournaments set status = 'finished', next_round_at = null where id = $1", [id]);
        await logEvent(tx, id, "status_changed", { status: "finished", from: t.status });
      }
    });
    if (refunds.length) await refundAll(db, id, refunds);
    done(id);
  });
}

// ───────────── inscritos ─────────────

async function playerTournament(playerId: string) {
  const [p] = await getDb().query<PlayerRow>("select * from players where id = $1", [playerId]);
  if (!p) throw new UserError("Jogador não encontrado.");
  return p;
}

export async function confirmPixAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const pid = uuid.parse(str(fd, "player"));
    const p = await playerTournament(pid);
    await confirmPayment(getDb(), pid, str(fd, "ref") || null, "admin");
    done(p.tournament_id);
  });
}

export async function refundAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const pid = uuid.parse(str(fd, "player"));
    const p = await playerTournament(pid);
    const db = getDb();
    if (mpEnabled()) await refundPlayer(db, pid);
    await markRefunded(db, pid, "admin");
    done(p.tournament_id);
  });
}

export async function dropAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const pid = uuid.parse(str(fd, "player"));
    const p = await playerTournament(pid);
    await adminDropPlayer(getDb(), pid, str(fd, "dropped") === "1", str(fd, "reason") || null);
    done(p.tournament_id);
  });
}

export async function checkinPlayerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const pid = uuid.parse(str(fd, "player"));
    const p = await playerTournament(pid);
    await adminSetCheckin(getDb(), pid, str(fd, "on") === "1", new Date());
    done(p.tournament_id);
  });
}

export async function editDeckAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const pid = uuid.parse(str(fd, "player"));
    const p = await playerTournament(pid);
    await saveDecklist(getDb(), p, z.string().max(5000).parse(str(fd, "decklist")), "admin");
    done(p.tournament_id);
    return "Lista salva.";
  });
}

export async function editPlayerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const pid = uuid.parse(str(fd, "player"));
    const p = await playerTournament(pid);
    const name = z.string().trim().min(2).max(60).parse(str(fd, "name"));
    const tcg = z.string().trim().min(2).max(40).parse(str(fd, "tcglive"));
    const wa = z.string().trim().max(30).parse(str(fd, "whatsapp"));
    await getDb().query("update players set name = $2, tcglive_name = $3, whatsapp = $4 where id = $1", [pid, name, tcg, wa]);
    await logEvent(getDb(), p.tournament_id, "player_edited", { player: name, player_id: pid });
    done(p.tournament_id);
    return "Dados salvos.";
  });
}

// ───────────── rodadas e mesas ─────────────

export async function openRoundAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const r = await adminOpenNextRound(getDb(), id, new Date());
    done(id);
    if (!r) return "Nada para abrir agora (rodada aberta, mesas pendentes ou torneio encerrado).";
  });
}

export async function undoRoundAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    await adminUndoRound(getDb(), id, str(fd, "reopen") === "1", new Date());
    done(id);
  });
}

export async function adjustTimeAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const round = uuid.parse(str(fd, "round"));
    const minutes = z.coerce.number().int().min(-60).max(60).parse(str(fd, "minutes"));
    await adminAdjustTime(getDb(), round, minutes);
    done(id);
  });
}

export async function setResultAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const match = uuid.parse(str(fd, "match"));
    const op = str(fd, "op");
    const note = str(fd, "note").trim() || null;
    const db = getDb();
    if (op === "penalty_p1" || op === "penalty_p2") {
      const [m] = await db.query<{ p1_id: string; p2_id: string }>("select p1_id, p2_id from matches where id = $1", [match]);
      if (!m) throw new UserError("Partida não encontrada.");
      await adminPenalty(db, match, op === "penalty_p1" ? m.p1_id : m.p2_id, new Date());
    } else if (op === "reopen") {
      await adminReopenMatch(db, match);
    } else {
      const result = z.enum(["p1", "p2", "tie", "double_loss"]).parse(op);
      await adminSetResult(db, match, result, note, new Date());
    }
    done(id);
  });
}

export async function manualByeAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const player = uuid.parse(str(fd, "player"));
    await adminManualBye(getDb(), id, player, new Date());
    done(id);
  });
}

export async function tickNowAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const out = await runTournamentTick(getDb(), id, true);
    done(id);
    return out && out.steps > 0 ? `${out.steps} ação(ões) automática(s) executada(s).` : "Nada pendente agora.";
  });
}

// ───────────── simulação ─────────────

export async function startSimulationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const res = await safe(async () => {
    await guard();
    const players = z.coerce.number().int().min(4).max(16).parse(str(fd, "players") || "12");
    const t = await createSimulation(getDb(), { players });
    await runTournamentTick(getDb(), t.id, true);
    id = t.id;
  });
  if (id) redirect(`/admin/t/${id}`);
  return res;
}

export async function deleteSimulationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let ok = false;
  const res = await safe(async () => {
    await guard();
    const id = uuid.parse(str(fd, "id"));
    const db = getDb();
    const t = await getTournament(db, id);
    if (!t?.is_simulation) throw new UserError("Só torneios de simulação podem ser apagados.");
    await db.query("delete from tournaments where id = $1", [id]);
    ok = true;
  });
  if (ok) redirect("/admin");
  return res;
}
