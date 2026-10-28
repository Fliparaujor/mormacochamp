"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/server/db";
import { safe, str, type ActionResult } from "@/lib/server/action-utils";
import { registerPlayer, updateDecklist } from "@/lib/server/registration";
import {
  getTournament,
  getTournamentBySlug,
  playerByToken,
  playerCheckin,
  playerDrop,
  playerReport,
  UserError,
} from "@/lib/server/tournament";
import { savePrint } from "@/lib/server/storage";
import { ensurePixCharge, latestPayment, syncMercadoPagoPayment } from "@/lib/server/payments";

const tokenSchema = z.string().regex(/^[A-Za-z0-9]{32}$/, "Link inválido.");

const registrationSchema = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(2, "Coloca seu nome.").max(60, "Nome muito longo."),
  tcgliveName: z.string().trim().min(2, "Coloca seu nome no TCG Live.").max(40, "Nome do TCG Live muito longo."),
  whatsapp: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^\d+]/g, ""))
    .refine((v) => v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 14, "WhatsApp inválido. Usa DDD + número."),
  email: z.union([z.literal(""), z.string().trim().email("E-mail inválido.")]).optional(),
  decklist: z.string().max(5000, "Lista muito longa.").optional(),
  website: z.string().max(0).optional(), // honeypot
  accept: z.literal("on", { errorMap: () => ({ message: "Você precisa aceitar o regulamento." }) }),
});

export async function registerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const res = await safe(async () => {
    const input = registrationSchema.parse({
      slug: str(fd, "slug"),
      name: str(fd, "name"),
      tcgliveName: str(fd, "tcgliveName"),
      whatsapp: str(fd, "whatsapp"),
      email: str(fd, "email"),
      decklist: str(fd, "decklist"),
      website: str(fd, "website"),
      accept: str(fd, "accept"),
    });
    const db = getDb();
    const t = await getTournamentBySlug(db, input.slug);
    if (!t) throw new UserError("Torneio não encontrado.");
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip");
    const p = await registerPlayer(db, {
      tournamentId: t.id,
      name: input.name,
      tcgliveName: input.tcgliveName,
      whatsapp: input.whatsapp,
      email: input.email || null,
      decklist: input.decklist,
      ip,
    });
    target = `/t/${t.slug}/p/${p.token}?novo=1`;
  });
  if (target) redirect(target);
  return res;
}

export async function checkinAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const token = tokenSchema.parse(str(fd, "token"));
    await playerCheckin(getDb(), token, new Date());
    return "Check-in feito. Agora é só esperar o pareamento.";
  });
}

export async function deckAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const token = tokenSchema.parse(str(fd, "token"));
    const text = z.string().max(5000, "Lista muito longa.").parse(str(fd, "decklist"));
    await updateDecklist(getDb(), token, text);
    return "Lista salva.";
  });
}

export async function dropAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const token = tokenSchema.parse(str(fd, "token"));
    await playerDrop(getDb(), token);
    return "Você saiu do torneio.";
  });
}

export async function reportAction(fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const token = tokenSchema.parse(str(fd, "token"));
    const matchId = z.string().uuid("Partida inválida.").parse(str(fd, "matchId"));
    const report = z.enum(["win", "loss"], { errorMap: () => ({ message: "Escolha se venceu ou perdeu." }) }).parse(str(fd, "report"));
    const file = fd.get("print");
    if (!(file instanceof File) || file.size === 0) throw new UserError("O print da tela final é obrigatório.");
    const db = getDb();
    const p = await playerByToken(db, token);
    const ref = await savePrint(db, file, `${p.tournament_id}/${matchId}`);
    await playerReport(db, { token, matchId, report, printUrl: ref }, new Date());
    return "Resultado enviado.";
  });
}

export async function pixAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const token = tokenSchema.parse(str(fd, "token"));
    const db = getDb();
    const p = await playerByToken(db, token);
    const t = (await getTournament(db, p.tournament_id))!;
    const pay = await latestPayment(db, p.id);
    if (pay?.provider === "mercadopago" && pay.external_id && p.payment_status === "pending") {
      const status = await syncMercadoPagoPayment(db, pay.external_id);
      if (status === "approved") return "Pagamento confirmado.";
      if (status === "pending") return "Ainda aguardando o Pix.";
    }
    await ensurePixCharge(db, t, p);
  });
}
