import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { runAllTicks } from "@/lib/server/automation";
import { safeEqual } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron a cada minuto (Supabase pg_cron + pg_net, Vercel Cron ou qualquer pinger).
 * Autenticação: header "Authorization: Bearer CRON_SECRET" ou ?secret=CRON_SECRET.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET não configurado" }, { status: 500 });
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("secret") ?? "";
  if (!safeEqual(auth, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const outs = await runAllTicks(getDb());
  return NextResponse.json({ ok: true, tournaments: outs.length, steps: outs.reduce((s, o) => s + o.steps, 0) });
}

export const GET = handle;
export const POST = handle;
