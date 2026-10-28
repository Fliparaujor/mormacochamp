import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { runTournamentTick } from "@/lib/server/automation";

export const dynamic = "force-dynamic";

/** Tick disparado pelas páginas abertas. Idempotente e com throttle. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.t === "string" ? body.t : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const out = await runTournamentTick(getDb(), id);
    return NextResponse.json({ ok: true, steps: out?.steps ?? 0 });
  } catch (e) {
    console.error("tick", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
