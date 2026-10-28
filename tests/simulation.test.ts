import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/pglite";
import type { Db } from "@/lib/server/db";
import { createSimulation } from "@/lib/server/simulation";
import {
  adminSetResult,
  computePlacements,
  confirmPayment,
  loadState,
  playerCheckin,
  playerReport,
  tickTournament,
  adminReopenMatch,
  adminUndoRound,
} from "@/lib/server/tournament";
import { registerPlayer } from "@/lib/server/registration";
import type { TournamentRow } from "@/lib/server/rows";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function eventCount(tid: string) {
  const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from events where tournament_id = $1", [tid]);
  return n;
}

describe("simulação end-to-end", () => {
  it("12 jogadores: check-in, 4 rodadas, top 4, final e campeão, só no automático", async () => {
    const t0 = new Date("2026-10-31T22:30:00Z");
    const t = await createSimulation(db, { players: 12, now: t0, checkinSeconds: 60, roundMinutes: 2, delaySeconds: 10 });
    let now = t0;
    let state = await loadState(db, t.id);
    for (let i = 0; i < 400 && state.t.status !== "finished"; i++) {
      now = new Date(now.getTime() + 10_000);
      await tickTournament(db, t.id, now);
      // Idempotência: rodar de novo no mesmo instante não muda nada.
      const before = await eventCount(t.id);
      const again = await tickTournament(db, t.id, now);
      expect(again.steps).toBe(0);
      expect(await eventCount(t.id)).toBe(before);
      state = await loadState(db, t.id);
    }
    expect(state.t.status).toBe("finished");
    expect(state.t.swiss_rounds).toBe(4);
    expect(state.t.topcut_size).toBe(4);
    const swiss = state.rounds.filter((r) => r.stage === "swiss");
    const cut = state.rounds.filter((r) => r.stage === "topcut");
    expect(swiss.length).toBe(4);
    expect(cut.length).toBe(2);
    expect(state.rounds.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.rounds.every((r) => r.status === "closed")).toBe(true);
    expect(state.matches.every((m) => m.result && !m.disputed)).toBe(true);
    expect(state.matches.filter((m) => m.round_id === cut[0].id).length).toBe(2);
    expect(state.matches.filter((m) => m.round_id === cut[1].id).length).toBe(1);
    const placements = computePlacements(state);
    expect(placements.length).toBe(12);
    expect(placements[0].prizeCents).toBe(10000);
    expect(placements[1].prizeCents).toBe(4500);
    expect(placements[2].prizeCents).toBe(2500);
    const final = state.matches.find((m) => m.round_id === cut[1].id)!;
    const champion = final.result === "p1" ? final.p1_id : final.p2_id;
    expect(placements[0].playerId).toBe(champion);
    const types = (await db.query<{ type: string }>("select type from events where tournament_id = $1", [t.id])).map((e) => e.type);
    for (const ty of ["checkin_opened", "checkin_closed", "seeds_drawn", "round_opened", "round_closed", "topcut_started", "finished"]) {
      expect(types).toContain(ty);
    }
    const cache = await db.query("select * from standings_cache where tournament_id = $1", [t.id]);
    expect(cache.length).toBe(12);
  });
});

async function makeTournament(over: Partial<TournamentRow> = {}): Promise<TournamentRow> {
  const [t] = await db.query<TournamentRow>(
    `insert into tournaments (slug, name, starts_at, status, checkin_opens_at, checkin_closes_at, round_minutes, auto_next_round_delay_seconds, min_players)
     values ($1, 'Teste', $2, 'registration', $3, $4, 25, 120, $5) returning *`,
    [over.slug ?? "teste", over.starts_at ?? new Date("2026-10-31T23:00:00Z"), new Date("2026-10-31T22:30:00Z"), new Date("2026-10-31T22:45:00Z"), over.min_players ?? 8],
  );
  return t;
}

async function addPlayers(t: TournamentRow, n: number, paid = true) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = await registerPlayer(db, { tournamentId: t.id, name: `Jogador ${i + 1}`, tcgliveName: `live${i + 1}`, whatsapp: "85999990000" });
    if (paid) await confirmPayment(db, p.id, null, "admin");
    out.push(p);
  }
  return out;
}

describe("fluxo real com reportes", () => {
  it("cancela por falta de quórum e dropa quem não fez check-in", async () => {
    const t = await makeTournament();
    const ps = await addPlayers(t, 9);
    await tickTournament(db, t.id, new Date("2026-10-31T22:31:00Z"));
    for (const p of ps.slice(0, 7)) await playerCheckin(db, p.token, new Date("2026-10-31T22:32:00Z"));
    await tickTournament(db, t.id, new Date("2026-10-31T22:45:00Z"));
    const s = await loadState(db, t.id);
    expect(s.t.status).toBe("cancelled");
    expect(s.players.filter((p) => p.dropped && p.drop_reason === "sem check-in").length).toBe(2);
  });

  it("as quatro situações de confirmação, disputa no fechamento e reversão", async () => {
    const t = await makeTournament();
    const ps = await addPlayers(t, 9);
    await addPlayers({ ...t }, 0);
    // não pago não pode fazer check-in
    const unpaid = await registerPlayer(db, { tournamentId: t.id, name: "Sem Pix", tcgliveName: "sempix", whatsapp: "85" });
    await tickTournament(db, t.id, new Date("2026-10-31T22:30:00Z"));
    await expect(playerCheckin(db, unpaid.token, new Date("2026-10-31T22:31:00Z"))).rejects.toThrow(/pagamento/);
    for (const p of ps) await playerCheckin(db, p.token, new Date("2026-10-31T22:31:00Z"));
    const start = new Date("2026-10-31T22:45:00Z");
    await tickTournament(db, t.id, start);
    let s = await loadState(db, t.id);
    expect(s.t.status).toBe("swiss");
    const r1 = s.rounds[0];
    expect(r1.status).toBe("live");
    const ms = s.matches.filter((m) => m.round_id === r1.id).sort((a, b) => a.table_number - b.table_number);
    expect(ms.length).toBe(5);
    const bye = ms.find((m) => !m.p2_id)!;
    expect(bye.result).toBe("p1");
    expect(bye.result_source).toBe("bye");
    const tok = (id: string | null) => ps.find((p) => p.id === id)!.token;
    const real = ms.filter((m) => m.p2_id);
    const at = (min: number) => new Date(start.getTime() + min * 60_000);

    // 1. ambos iguais
    await playerReport(db, { token: tok(real[0].p1_id), matchId: real[0].id, report: "win", printUrl: "x" }, at(10));
    await playerReport(db, { token: tok(real[0].p2_id), matchId: real[0].id, report: "loss", printUrl: "y" }, at(11));
    // 2. conflito
    await playerReport(db, { token: tok(real[1].p1_id), matchId: real[1].id, report: "win", printUrl: "x" }, at(10));
    await playerReport(db, { token: tok(real[1].p2_id), matchId: real[1].id, report: "win", printUrl: "y" }, at(12));
    // 3. só um reporta
    await playerReport(db, { token: tok(real[2].p2_id), matchId: real[2].id, report: "win", printUrl: "y" }, at(20));
    // real[3]: ninguém reporta
    s = await loadState(db, t.id);
    const get = (id: string) => s.matches.find((m) => m.id === id)!;
    expect(get(real[0].id).result).toBe("p1");
    expect(get(real[0].id).result_source).toBe("both");
    expect(get(real[1].id).disputed).toBe(true);
    expect(get(real[2].id).result).toBeNull();

    await tickTournament(db, t.id, at(29)); // fim + 4 min: nada
    s = await loadState(db, t.id);
    expect(get(real[2].id).result).toBeNull();
    await tickTournament(db, t.id, at(30)); // fim + 5 min: confirma por tempo
    s = await loadState(db, t.id);
    expect(get(real[2].id).result).toBe("p2");
    expect(get(real[2].id).result_source).toBe("auto");
    expect(get(real[3].id).disputed).toBe(false);
    await tickTournament(db, t.id, at(35)); // fim + 10: sem reporte vira disputa
    s = await loadState(db, t.id);
    expect(get(real[3].id).disputed).toBe(true);
    expect(get(real[3].id).result).toBeNull();
    // reporte fechado
    await expect(
      playerReport(db, { token: tok(real[3].p1_id), matchId: real[3].id, report: "win", printUrl: "x" }, at(36)),
    ).rejects.toThrow();
    expect(s.rounds[0].status).toBe("live");

    // juiz resolve
    await adminSetResult(db, real[1].id, "p2", "print do p2 confere", at(37));
    await adminSetResult(db, real[3].id, "tie", null, at(37));
    s = await loadState(db, t.id);
    expect(s.rounds[0].status).toBe("closed");
    expect(s.t.next_round_at).not.toBeNull();

    // admin reverte o auto: rodada reabre e agendamento some
    await adminReopenMatch(db, real[2].id);
    s = await loadState(db, t.id);
    expect(s.rounds[0].status).toBe("live");
    expect(s.t.next_round_at).toBeNull();
    await adminSetResult(db, real[2].id, "p1", "corrigido", at(38));

    // próxima rodada abre sozinha após o delay
    await tickTournament(db, t.id, at(38.5));
    s = await loadState(db, t.id);
    expect(s.rounds.length).toBe(1);
    await tickTournament(db, t.id, at(40));
    s = await loadState(db, t.id);
    expect(s.rounds.length).toBe(2);
    expect(s.rounds[1].status).toBe("live");

    // re-parear
    await adminUndoRound(db, t.id, true, at(41));
    s = await loadState(db, t.id);
    expect(s.rounds.length).toBe(2);
    expect(s.rounds[1].number).toBe(2);
  });
});
