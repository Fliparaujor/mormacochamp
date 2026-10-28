import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { mpEnabled, syncMercadoPagoPayment, verifyMercadoPagoSignature } from "@/lib/server/payments";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!mpEnabled()) return NextResponse.json({ ok: false, error: "Mercado Pago desligado" }, { status: 404 });
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const dataId: string | null = url.searchParams.get("data.id") ?? body?.data?.id?.toString() ?? null;
  const type = url.searchParams.get("type") ?? body?.type ?? body?.topic;
  if (!verifyMercadoPagoSignature(req.headers, dataId)) {
    return NextResponse.json({ ok: false, error: "assinatura inválida" }, { status: 401 });
  }
  if (type !== "payment" || !dataId) return NextResponse.json({ ok: true, ignored: true });
  try {
    // Nunca confia no corpo do webhook: busca o pagamento na API antes de marcar como pago.
    const status = await syncMercadoPagoPayment(getDb(), dataId);
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error("mp webhook", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
