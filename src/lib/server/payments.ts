import crypto from "node:crypto";
import type { Db } from "./db";
import type { PlayerRow, TournamentRow } from "./rows";
import { confirmPayment, logEvent, markRefunded } from "./tournament";

const MP_API = "https://api.mercadopago.com";

export function mpEnabled(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

/** Modo efetivo: mercadopago só se o torneio pedir e o token existir. Sem token, cai no manual. */
export function effectivePixMode(t: Pick<TournamentRow, "pix_mode">): "manual" | "mercadopago" {
  return t.pix_mode === "mercadopago" && mpEnabled() ? "mercadopago" : "manual";
}

async function mp(path: string, init: RequestInit & { idempotencyKey?: string } = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${body?.message ?? "erro"}`);
  return body;
}

export interface PaymentRow {
  id: string;
  player_id: string;
  provider: string;
  external_id: string | null;
  qr_code: string | null;
  qr_base64: string | null;
  amount_cents: number;
  status: string;
  created_at: Date;
}

export async function latestPayment(db: Db, playerId: string): Promise<PaymentRow | null> {
  const [p] = await db.query<PaymentRow>(
    "select * from payments where player_id = $1 order by created_at desc limit 1",
    [playerId],
  );
  return p ?? null;
}

/** Cria (ou reaproveita) a cobrança Pix dinâmica do jogador. */
export async function ensurePixCharge(db: Db, t: TournamentRow, p: PlayerRow): Promise<PaymentRow | null> {
  if (effectivePixMode(t) !== "mercadopago" || p.payment_status !== "pending") return null;
  const existing = await latestPayment(db, p.id);
  if (existing && existing.provider === "mercadopago" && existing.status === "pending") return existing;
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const body = await mp("/v1/payments", {
    method: "POST",
    idempotencyKey: `arena-${p.id}-${existing?.id ?? "1"}`,
    body: JSON.stringify({
      transaction_amount: t.entry_fee_cents / 100,
      description: `Inscrição ${t.name}`,
      payment_method_id: "pix",
      external_reference: p.id,
      notification_url: appUrl ? `${appUrl}/api/webhooks/mercadopago` : undefined,
      payer: { email: p.email || `jogador-${p.id.slice(0, 8)}@arena.mormaco.com.br`, first_name: p.name },
      date_of_expiration: new Date(Date.now() + 24 * 3600_000).toISOString(),
    }),
  });
  const tx = body?.point_of_interaction?.transaction_data ?? {};
  const [row] = await db.query<PaymentRow>(
    `insert into payments (player_id, provider, external_id, qr_code, qr_base64, amount_cents, status, raw)
     values ($1, 'mercadopago', $2, $3, $4, $5, $6, $7) returning *`,
    [p.id, String(body.id), tx.qr_code ?? null, tx.qr_code_base64 ?? null, t.entry_fee_cents, body.status ?? "pending", JSON.stringify(body)],
  );
  await logEvent(db, t.id, "pix_created", { player: p.name, player_id: p.id });
  return row;
}

/** Consulta o pagamento no Mercado Pago e aplica. Só marca pago com status approved vindo da API. */
export async function syncMercadoPagoPayment(db: Db, externalId: string): Promise<string> {
  const body = await mp(`/v1/payments/${encodeURIComponent(externalId)}`);
  const status: string = body.status ?? "unknown";
  const playerId: string | undefined = body.external_reference;
  const [row] = await db.query<PaymentRow>("select * from payments where external_id = $1", [String(body.id)]);
  if (row) {
    await db.query("update payments set status = $2, raw = $3 where id = $1", [row.id, status, JSON.stringify(body)]);
  }
  const pid = row?.player_id ?? playerId;
  if (!pid) return status;
  if (status === "approved") {
    await confirmPayment(db, pid, String(body.id), "auto", "mercadopago");
  } else if (status === "refunded") {
    await markRefunded(db, pid, "auto", "mercadopago");
  }
  return status;
}

export async function refundPlayer(db: Db, playerId: string): Promise<void> {
  const [pay] = await db.query<PaymentRow>(
    "select * from payments where player_id = $1 and provider = 'mercadopago' and status = 'approved' order by created_at desc limit 1",
    [playerId],
  );
  if (!pay?.external_id) return; // pagamento manual: devolução é feita à mão pelo admin
  await mp(`/v1/payments/${pay.external_id}/refunds`, { method: "POST", idempotencyKey: `refund-${pay.id}`, body: "{}" });
  await db.query("update payments set status = 'refunded' where id = $1", [pay.id]);
  await markRefunded(db, playerId, "auto", "mercadopago");
}

export async function refundAll(db: Db, tournamentId: string, playerIds: string[]) {
  if (!mpEnabled()) return;
  for (const id of playerIds) {
    try {
      await refundPlayer(db, id);
    } catch (e) {
      await logEvent(db, tournamentId, "refund_failed", { player_id: id, error: (e as Error).message });
    }
  }
}

/**
 * Valida o header x-signature do webhook do Mercado Pago.
 * manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};" assinado com HMAC-SHA256(MP_WEBHOOK_SECRET).
 */
export function verifyMercadoPagoSignature(headers: Headers, dataId: string | null): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;
  const sigHeader = headers.get("x-signature") ?? "";
  const requestId = headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const [k, ...v] = kv.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  if (!parts.ts || !parts.v1) return false;
  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
