import { describe, expect, it } from "vitest";
import { computeStandings, winPercentage } from "@/lib/engine/standings";
import { pairSwissRound } from "@/lib/engine/pairing";
import { autoStructure, prizeBandFor, resolveStructure } from "@/lib/engine/structure";
import { bracketSeedOrder, finalPlacements, firstCutPairings, nextCutPairings } from "@/lib/engine/topcut";
import { decideMatch, canReport } from "@/lib/engine/results";
import { parseDecklist } from "@/lib/engine/decklist";
import { mulberry32, shuffle } from "@/lib/engine/rng";
import type { EngineMatch, EnginePlayer, MatchResult } from "@/lib/engine/types";

function makePlayers(n: number, rand: () => number): EnginePlayer[] {
  const seeds = shuffle(
    Array.from({ length: n }, (_, i) => i + 1),
    rand,
  );
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seed: seeds[i], dropped: false }));
}

/** Roda um suíço completo com resultados aleatórios e devolve tudo. */
function runSwiss(n: number, rounds: number, seed: number, opts: { tieRate?: number; dropAfter?: Record<number, string[]> } = {}) {
  const rand = mulberry32(seed);
  const players = makePlayers(n, rand);
  const matches: EngineMatch[] = [];
  const rematches: Array<[string, string]> = [];
  const byes: string[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (const id of opts.dropAfter?.[r - 1] ?? []) players.find((p) => p.id === id)!.dropped = true;
    const standings = computeStandings(players, matches);
    const out = pairSwissRound({ roundNumber: r, standings, pastMatches: matches });
    rematches.push(...out.forcedRematches);
    const active = players.filter((p) => !p.dropped).map((p) => p.id);
    // Cada ativo aparece exatamente uma vez.
    const seen = out.pairings.flatMap((p) => (p.p2 ? [p.p1, p.p2] : [p.p1]));
    expect(seen.sort()).toEqual([...active].sort());
    // Mesas sequenciais
    expect(out.pairings.map((p) => p.tableNumber)).toEqual(out.pairings.map((_, i) => i + 1));
    if (active.length % 2 === 1) {
      expect(out.byePlayer).not.toBeNull();
      byes.push(out.byePlayer!);
    } else {
      expect(out.byePlayer).toBeNull();
    }
    for (const p of out.pairings) {
      let result: MatchResult;
      if (!p.p2) result = "p1";
      else {
        const x = rand();
        result = x < (opts.tieRate ?? 0.05) ? "tie" : x < 0.5 ? "p1" : "p2";
      }
      matches.push({ roundNumber: r, stage: "swiss", tableNumber: p.tableNumber, p1: p.p1, p2: p.p2, result });
    }
  }
  return { players, matches, rematches, byes, standings: computeStandings(players, matches) };
}

describe("pareamento suíço", () => {
  const cases: Array<[number, number]> = [
    [8, 4],
    [9, 4],
    [12, 4],
    [16, 5],
    [17, 5],
    [32, 5],
  ];
  for (const [n, rounds] of cases) {
    it(`${n} jogadores, ${rounds} rodadas: sem rematch, bye correto`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { rematches, byes, matches } = runSwiss(n, rounds, seed * 7919 + n);
        expect(rematches).toEqual([]);
        // Ninguém repete oponente
        const pairsSeen = new Set<string>();
        for (const m of matches) {
          if (!m.p2) continue;
          const key = [m.p1, m.p2].sort().join("-");
          expect(pairsSeen.has(key)).toBe(false);
          pairsSeen.add(key);
        }
        // Ninguém recebe dois byes enquanto houver gente sem bye
        expect(new Set(byes).size).toBe(byes.length);
        if (n % 2 === 0) expect(byes).toEqual([]);
        else expect(byes.length).toBe(rounds);
      }
    });
  }

  it("rodada 1 segue a seed sorteada e dá bye à última seed", () => {
    const players: EnginePlayer[] = [
      { id: "a", seed: 3, dropped: false },
      { id: "b", seed: 1, dropped: false },
      { id: "c", seed: 2, dropped: false },
      { id: "d", seed: 5, dropped: false },
      { id: "e", seed: 4, dropped: false },
    ];
    const out = pairSwissRound({ roundNumber: 1, standings: computeStandings(players, []), pastMatches: [] });
    expect(out.pairings).toEqual([
      { tableNumber: 1, p1: "b", p2: "c" },
      { tableNumber: 2, p1: "a", p2: "e" },
      { tableNumber: 3, p1: "d", p2: null },
    ]);
  });

  it("bye vai para o último colocado sem bye", () => {
    const players: EnginePlayer[] = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, seed: i + 1, dropped: false }));
    const matches: EngineMatch[] = [
      { roundNumber: 1, stage: "swiss", tableNumber: 1, p1: "a", p2: "b", result: "p1" },
      { roundNumber: 1, stage: "swiss", tableNumber: 2, p1: "c", p2: "d", result: "p1" },
      { roundNumber: 1, stage: "swiss", tableNumber: 3, p1: "e", p2: null, result: "p1" },
    ];
    const standings = computeStandings(players, matches);
    const out = pairSwissRound({ roundNumber: 2, standings, pastMatches: matches });
    // e já teve bye; os últimos são b e d (0 pontos). O último da tabela leva o bye.
    const last = standings.filter((s) => s.playerId !== "e").at(-1)!.playerId;
    expect(out.byePlayer).toBe(last);
  });

  it("dropped não pareia", () => {
    const { players, matches } = runSwiss(12, 4, 42, { dropAfter: { 1: ["p3"], 2: ["p7", "p8"] } });
    const late = matches.filter((m) => m.roundNumber >= 2);
    expect(late.some((m) => m.p1 === "p3" || m.p2 === "p3")).toBe(false);
    const after3 = matches.filter((m) => m.roundNumber >= 3);
    expect(after3.some((m) => ["p7", "p8"].includes(m.p1) || ["p7", "p8"].includes(m.p2 ?? ""))).toBe(false);
    expect(players.filter((p) => p.dropped).length).toBe(3);
  });

  it("pareia dentro do grupo de pontos de cima pra baixo", () => {
    const players: EnginePlayer[] = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, seed: i + 1, dropped: false }));
    const r1 = pairSwissRound({ roundNumber: 1, standings: computeStandings(players, []), pastMatches: [] });
    const matches: EngineMatch[] = r1.pairings.map((p) => ({ roundNumber: 1, stage: "swiss", tableNumber: p.tableNumber, p1: p.p1, p2: p.p2, result: "p1" }));
    const standings = computeStandings(players, matches);
    const r2 = pairSwissRound({ roundNumber: 2, standings, pastMatches: matches });
    const pts = new Map(standings.map((s) => [s.playerId, s.matchPoints]));
    for (const p of r2.pairings) expect(pts.get(p.p1)).toBe(pts.get(p.p2!));
  });

  it("rematch forçado quando não há saída", () => {
    // 4 jogadores, 4 rodadas: na 4ª não existe pareamento sem repetir.
    const players: EnginePlayer[] = ["a", "b", "c", "d"].map((id, i) => ({ id, seed: i + 1, dropped: false }));
    const matches: EngineMatch[] = [];
    let forced = 0;
    for (let r = 1; r <= 4; r++) {
      const out = pairSwissRound({ roundNumber: r, standings: computeStandings(players, matches), pastMatches: matches });
      forced += out.forcedRematches.length;
      for (const p of out.pairings) matches.push({ roundNumber: r, stage: "swiss", tableNumber: p.tableNumber, p1: p.p1, p2: p.p2, result: "p1" });
    }
    expect(forced).toBeGreaterThan(0);
  });
});

describe("desempate", () => {
  it("win% tem piso de 25%", () => {
    expect(winPercentage(0, 0, 4)).toBe(0.25);
    expect(winPercentage(1, 0, 4)).toBe(0.25);
    expect(winPercentage(2, 0, 4)).toBe(0.5);
    expect(winPercentage(1, 1, 2)).toBeCloseTo(4 / 6);
    expect(winPercentage(0, 0, 0)).toBe(0.25);
  });

  it("OWP com piso, bye não conta como oponente, e OOWP", () => {
    const players: EnginePlayer[] = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, seed: i + 1, dropped: false }));
    const matches: EngineMatch[] = [
      // R1
      { roundNumber: 1, stage: "swiss", tableNumber: 1, p1: "a", p2: "b", result: "p1" },
      { roundNumber: 1, stage: "swiss", tableNumber: 2, p1: "c", p2: "d", result: "p1" },
      { roundNumber: 1, stage: "swiss", tableNumber: 3, p1: "e", p2: null, result: "p1" },
      // R2
      { roundNumber: 2, stage: "swiss", tableNumber: 1, p1: "a", p2: "c", result: "p1" },
      { roundNumber: 2, stage: "swiss", tableNumber: 2, p1: "e", p2: "b", result: "p1" },
      { roundNumber: 2, stage: "swiss", tableNumber: 3, p1: "d", p2: null, result: "p1" },
    ];
    const s = computeStandings(players, matches);
    const by = Object.fromEntries(s.map((r) => [r.playerId, r]));
    // win%: a 2/2=1, b 0/2→0.25, c 1/2=.5, d 0/1→0.25, e 1/1=1
    expect(by.a.winPct).toBe(1);
    expect(by.b.winPct).toBe(0.25);
    expect(by.d.winPct).toBe(0.25);
    expect(by.e.winPct).toBe(1);
    // OWP(a) = avg(b .25, c .5) = .375; OWP(e) = avg(b .25) = .25 (bye ignorado)
    expect(by.a.owp).toBeCloseTo(0.375);
    expect(by.e.owp).toBeCloseTo(0.25);
    // OWP(b)=avg(a 1, e 1)=1; OWP(c)=avg(d .25, a 1)=.625
    // OOWP(a) = avg(OWP b 1, OWP c .625) = .8125
    expect(by.a.oowp).toBeCloseTo(0.8125);
    // pontos: a 6, e 6 (bye=3), c 3, d 3 (bye), b 0
    expect(by.a.matchPoints).toBe(6);
    expect(by.e.matchPoints).toBe(6);
    expect(by.e.byes).toBe(1);
    expect(s[0].playerId).toBe("a"); // OWP .375 > .25
    expect(s[1].playerId).toBe("e");
    // c (OWP .625) acima de d (OWP de d = avg(c .5) = .5)
    expect(s[2].playerId).toBe("c");
    expect(s[3].playerId).toBe("d");
    expect(s[4].playerId).toBe("b");
  });

  it("empate total decide pelo sorteio (seed)", () => {
    const players: EnginePlayer[] = [
      { id: "x", seed: 2, dropped: false },
      { id: "y", seed: 1, dropped: false },
    ];
    const s = computeStandings(players, []);
    expect(s.map((r) => r.playerId)).toEqual(["y", "x"]);
  });

  it("empate e derrota dupla pontuam certo", () => {
    const players: EnginePlayer[] = ["a", "b", "c", "d"].map((id, i) => ({ id, seed: i + 1, dropped: false }));
    const matches: EngineMatch[] = [
      { roundNumber: 1, stage: "swiss", tableNumber: 1, p1: "a", p2: "b", result: "tie" },
      { roundNumber: 1, stage: "swiss", tableNumber: 2, p1: "c", p2: "d", result: "double_loss" },
    ];
    const by = Object.fromEntries(computeStandings(players, matches).map((r) => [r.playerId, r]));
    expect(by.a.matchPoints).toBe(1);
    expect(by.b.ties).toBe(1);
    expect(by.c.matchPoints).toBe(0);
    expect(by.d.losses).toBe(1);
  });
});

describe("estrutura automática", () => {
  it("faixas da especificação", () => {
    for (let n = 8; n <= 15; n++) expect(autoStructure(n)).toEqual({ swissRounds: 4, topCut: 4 });
    for (let n = 16; n <= 32; n++) expect(autoStructure(n)).toEqual({ swissRounds: 5, topCut: 8 });
  });
  it("override do admin", () => {
    expect(resolveStructure(12, { swissRounds: 5, topCut: 8 })).toEqual({ swissRounds: 5, topCut: 8 });
    expect(resolveStructure(12, { swissRounds: null, topCut: 0 })).toEqual({ swissRounds: 4, topCut: 0 });
    expect(resolveStructure(6, { topCut: 8 })).toEqual({ swissRounds: 3, topCut: 4 });
  });
  it("faixa de prêmio", () => {
    expect(prizeBandFor(7)).toBeNull();
    expect(prizeBandFor(8)!.prizes).toEqual([7000, 4000]);
    expect(prizeBandFor(12)!.prizes).toEqual([10000, 4500, 2500]);
    expect(prizeBandFor(27)!.prizes.length).toBe(4);
    expect(prizeBandFor(32)!.prizes[0]).toBe(20000);
  });
});

describe("top cut", () => {
  it("ordem da chave", () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it("chave completa do top 8 e colocação final", () => {
    const { standings } = runSwiss(16, 5, 99);
    const seeds = standings.slice(0, 8).map((s) => s.playerId);
    const qf = firstCutPairings(standings, 8);
    expect(qf.map((p) => [p.p1, p.p2])).toEqual([
      [seeds[0], seeds[7]],
      [seeds[3], seeds[4]],
      [seeds[1], seeds[6]],
      [seeds[2], seeds[5]],
    ]);
    const cut: EngineMatch[] = qf.map((p) => ({ roundNumber: 6, stage: "topcut", tableNumber: p.tableNumber, p1: p.p1, p2: p.p2, result: "p1" }));
    const sf = nextCutPairings(cut)!;
    expect(sf.map((p) => [p.p1, p.p2])).toEqual([
      [seeds[0], seeds[3]],
      [seeds[1], seeds[2]],
    ]);
    cut.push(...sf.map((p) => ({ roundNumber: 7, stage: "topcut" as const, tableNumber: p.tableNumber, p1: p.p1, p2: p.p2, result: "p2" as const })));
    const final = nextCutPairings(cut.filter((m) => m.roundNumber === 7))!;
    expect(final.map((p) => [p.p1, p.p2])).toEqual([[seeds[3], seeds[2]]]);
    cut.push({ roundNumber: 8, stage: "topcut", tableNumber: 1, p1: seeds[3], p2: seeds[2], result: "p1" });
    expect(nextCutPairings(cut.filter((m) => m.roundNumber === 8))).toEqual([]);
    const placing = finalPlacements(standings, cut);
    expect(placing.slice(0, 4)).toEqual([seeds[3], seeds[2], seeds[0], seeds[1]]);
    expect(placing.slice(4, 8)).toEqual(seeds.slice(4, 8));
    expect(placing.length).toBe(16);
  });
  it("partida sem vencedor bloqueia a próxima fase", () => {
    expect(nextCutPairings([{ roundNumber: 5, stage: "topcut", tableNumber: 1, p1: "a", p2: "b", result: null }])).toBeNull();
  });
});

describe("confirmação de resultado", () => {
  const ends = new Date("2026-10-31T23:25:00Z");
  const at = (min: number) => new Date(ends.getTime() + min * 60_000);
  const base = { p2: "b", p1Report: null, p2Report: null, result: null, disputed: false } as const;

  it("1. os dois reportam igual → confirmado (both)", () => {
    expect(decideMatch({ ...base, p1Report: "win", p2Report: "loss" }, at(-10), ends)).toEqual({ action: "confirm", result: "p1", source: "both" });
    expect(decideMatch({ ...base, p1Report: "loss", p2Report: "win" }, at(-10), ends)).toEqual({ action: "confirm", result: "p2", source: "both" });
  });
  it("2. reportam diferente → disputa", () => {
    expect(decideMatch({ ...base, p1Report: "win", p2Report: "win" }, at(-10), ends)).toEqual({ action: "dispute", reason: "conflict" });
    expect(decideMatch({ ...base, p1Report: "win", p2Report: "win", disputed: true }, at(20), ends)).toEqual({ action: "none" });
  });
  it("3. só um reportou: espera até fim + 5 min, depois confirma (auto)", () => {
    expect(decideMatch({ ...base, p2Report: "win" }, at(4), ends)).toEqual({ action: "none" });
    expect(decideMatch({ ...base, p2Report: "win" }, at(5), ends)).toEqual({ action: "confirm", result: "p2", source: "auto" });
  });
  it("4. bye → vitória automática", () => {
    expect(decideMatch({ ...base, p2: null }, at(-25), ends)).toEqual({ action: "confirm", result: "p1", source: "bye" });
  });
  it("sem reporte: disputa em fim + 10 min, nunca empate automático", () => {
    expect(decideMatch(base, at(9), ends)).toEqual({ action: "none" });
    expect(decideMatch(base, at(10), ends)).toEqual({ action: "dispute", reason: "no_report" });
  });
  it("reporte fecha em fim + 10 min", () => {
    expect(canReport(base, at(9), ends)).toBe(true);
    expect(canReport(base, at(10), ends)).toBe(false);
    expect(canReport({ ...base, result: "p1" }, at(0), ends)).toBe(false);
  });
});

describe("lista do deck", () => {
  it("lê o formato do TCG Live", () => {
    const text = `Pokémon: 12
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
1 Fezandipiti ex SFA 38

Trainer: 36
4 Arven SVI 166
4 Iono PAL 185
1 Pokégear 3.0 SVI 186
27 Ultra Ball SVI 196

Energy: 12
8 Basic Fire Energy SVE 2
4 Basic Psychic Energy SVE 5

Total Cards: 60`;
    const d = parseDecklist(text);
    expect(d.total).toBe(60);
    expect(d.ok).toBe(true);
    expect(d.cards[0]).toEqual({ qty: 4, name: "Dreepy", set: "TWM", number: "128", section: "pokemon" });
    expect(d.cards.find((c) => c.name === "Pokégear 3.0")!.set).toBe("SVI");
    expect(d.cards.find((c) => c.name === "Basic Fire Energy")!.section).toBe("energy");
    expect(d.warnings.some((w) => w.includes("ultra ball"))).toBe(true);
  });
  it("vazio não quebra", () => {
    const d = parseDecklist("");
    expect(d.total).toBe(0);
    expect(d.ok).toBe(false);
  });
});
