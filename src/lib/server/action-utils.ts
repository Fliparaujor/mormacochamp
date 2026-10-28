import { ZodError } from "zod";
import { UserError } from "./tournament";

export type ActionResult = { ok: boolean; error?: string; message?: string } | null;

export class AuthError extends Error {}

/** Executa a ação e converte erros conhecidos em mensagem amigável. */
export async function safe(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    const out = await fn();
    return { ok: true, message: typeof out === "string" ? out : undefined };
  } catch (e) {
    if (e instanceof UserError || e instanceof AuthError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Dados inválidos." };
    if (e instanceof Error && /print|imagem|Sessão|1 MB/.test(e.message)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Algo deu errado. Tenta de novo em instantes." };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
