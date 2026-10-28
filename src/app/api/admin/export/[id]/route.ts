import { getDb } from "@/lib/server/db";
import { isAdmin } from "@/lib/server/auth";
import { getTournament } from "@/lib/server/tournament";
import { eventText } from "@/lib/events-text";
import { fmtFull } from "@/lib/format";
import type { EventRow } from "@/lib/server/rows";

export const dynamic = "force-dynamic";

function csv(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exporta a trilha de auditoria (events) ou os inscritos em CSV. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return new Response("Não autorizado", { status: 401 });
  const { id } = await params;
  const db = getDb();
  const t = await getTournament(db, id);
  if (!t) return new Response("Não encontrado", { status: 404 });
  const kind = new URL(req.url).searchParams.get("tipo") ?? "eventos";
  let lines: string[];
  if (kind === "inscritos") {
    const ps = await db.query(
      "select name, tcglive_name, whatsapp, email, payment_status, checked_in, dropped, drop_reason, seed, created_at from players where tournament_id = $1 order by created_at",
      [id],
    );
    lines = ["nome,tcg_live,whatsapp,email,pagamento,checkin,drop,motivo_drop,seed,inscrito_em"];
    for (const p of ps) lines.push([p.name, p.tcglive_name, p.whatsapp, p.email, p.payment_status, p.checked_in, p.dropped, p.drop_reason, p.seed, fmtFull(p.created_at)].map(csv).join(","));
  } else {
    const evs = await db.query<EventRow>("select * from events where tournament_id = $1 order by id", [id]);
    lines = ["id,quando,tipo,descricao,payload"];
    for (const e of evs) lines.push([e.id, fmtFull(e.created_at), e.type, eventText(e.type, e.payload, true), e.payload].map(csv).join(","));
  }
  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t.slug}-${kind}.csv"`,
    },
  });
}
