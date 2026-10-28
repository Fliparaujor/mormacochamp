import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { safeEqual } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const PLACEHOLDER = /<|>|\[YOUR-PASSWORD\]|SUASENHA/i;

function checkVar(name: string, required: boolean): string {
  const v = process.env[name];
  if (!v) return required ? "FALTANDO" : "não configurada (opcional)";
  if (PLACEHOLDER.test(v)) return "ERRADA: ainda tem texto de exemplo";
  return "ok";
}

function checkDatabaseUrl(): string {
  const v = process.env.DATABASE_URL;
  if (!v) return "FALTANDO";
  if (PLACEHOLDER.test(v)) return "ERRADA: ainda tem texto de exemplo (<...> ou [YOUR-PASSWORD])";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "ERRADA: não é uma URI válida (senha com símbolo sem codificar?)";
  }
  if (u.hostname.startsWith("db.")) return "ERRADA: é a conexão direta (db.…). Use a do Transaction pooler (…pooler.supabase.com:6543)";
  if (/localhost|127\.0\.0\.1/.test(u.hostname)) return "ok";
  if (!u.hostname.endsWith("pooler.supabase.com")) return `atenção: host inesperado (${u.hostname})`;
  if (u.port !== "6543") return `atenção: porta ${u.port || "padrão"}; use 6543 (Transaction pooler)`;
  if (!u.username.includes(".")) return "ERRADA: o usuário deve ser postgres.<código do projeto>";
  if (!u.password) return "ERRADA: sem senha";
  return "ok";
}

/**
 * Diagnóstico da instalação, em português. Protegido pelo CRON_SECRET (?secret=...).
 * Nunca devolve valores de variáveis, só se estão ok.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret) return NextResponse.json({ ok: false, problema: "CRON_SECRET não configurado na Vercel" }, { status: 500 });
  if (!safeEqual(given, secret)) return NextResponse.json({ ok: false, problema: "segredo errado ou faltando no link (?secret=...)" }, { status: 401 });

  const variaveis = {
    DATABASE_URL: checkDatabaseUrl(),
    ADMIN_PASSWORD: checkVar("ADMIN_PASSWORD", true),
    SESSION_SECRET: checkVar("SESSION_SECRET", true),
    CRON_SECRET: "ok",
    SUPABASE_URL: checkVar("SUPABASE_URL", true),
    SUPABASE_SERVICE_ROLE_KEY: checkVar("SUPABASE_SERVICE_ROLE_KEY", true),
    NEXT_PUBLIC_SUPABASE_URL: checkVar("NEXT_PUBLIC_SUPABASE_URL", false),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: checkVar("NEXT_PUBLIC_SUPABASE_ANON_KEY", false),
    APP_URL: checkVar("APP_URL", false),
    STORE_WHATSAPP: checkVar("STORE_WHATSAPP", false),
  };

  let banco = "ok";
  let tabelasFaltando: string[] = [];
  let torneios: Array<{ slug: string; status: string }> = [];
  try {
    const db = getDb();
    const rows = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const have = new Set(rows.map((r) => r.table_name));
    tabelasFaltando = ["tournaments", "players", "rounds", "matches", "events", "payments", "standings_cache", "uploads"].filter(
      (t) => !have.has(t),
    );
    if (!tabelasFaltando.length) {
      torneios = await db.query("select slug, status from tournaments where not is_simulation order by starts_at");
    }
  } catch (e) {
    const msg = (e as Error).message || String(e);
    banco = `ERRO ao conectar: ${msg}`;
    if (/password authentication failed/i.test(msg)) banco += " → senha errada na DATABASE_URL";
    if (/Tenant or user not found/i.test(msg)) banco += " → usuário/host errado; copie a URI do Transaction pooler";
    if (/ENOTFOUND|getaddrinfo/i.test(msg)) banco += " → endereço do banco errado";
    if (/timeout/i.test(msg)) banco += " → sem resposta; provavelmente conexão direta (db.…) em vez do pooler";
  }

  const problemas = [
    ...Object.entries(variaveis)
      .filter(([, v]) => v !== "ok" && !v.includes("opcional"))
      .map(([k, v]) => `${k}: ${v}`),
    ...(banco !== "ok" ? [banco] : []),
    ...(tabelasFaltando.length ? [`Tabelas faltando: ${tabelasFaltando.join(", ")} → rode o schema.sql no SQL Editor`] : []),
    ...(banco === "ok" && !tabelasFaltando.length && !torneios.some((t) => t.slug === "noite-assombrada")
      ? ["Torneio noite-assombrada não existe → rode supabase/noite-assombrada.sql"]
      : []),
  ];

  return NextResponse.json({ ok: problemas.length === 0, problemas, variaveis, banco, tabelasFaltando, torneios });
}
