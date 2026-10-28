import { getDb } from "@/lib/server/db";
import { verifyPrintSig } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Prints guardados no banco (modo sem Supabase Storage). URL assinada e temporária. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyPrintSig(id, u.searchParams.get("exp") ?? "", u.searchParams.get("sig") ?? "")) {
    return new Response("Não autorizado", { status: 403 });
  }
  const [row] = await getDb().query<{ content_type: string; data: Buffer }>("select content_type, data from uploads where id = $1", [id]);
  if (!row) return new Response("Não encontrado", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: { "Content-Type": row.content_type, "Cache-Control": "private, max-age=3600" },
  });
}
