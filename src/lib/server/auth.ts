import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "arena_admin";
const MAX_AGE_S = 60 * 60 * 24 * 3;

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("Configure ADMIN_PASSWORD (e de preferência SESSION_SECRET).");
  return s;
}

export function sign(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function checkPassword(pw: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const h = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
  return safeEqual(h(pw), h(expected));
}

export async function createAdminSession() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const value = `admin.${exp}`;
  (await cookies()).set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroyAdminSession() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const i = raw.lastIndexOf(".");
  if (i < 0) return false;
  const value = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  try {
    if (!safeEqual(sig, sign(value))) return false;
  } catch {
    return false;
  }
  const exp = Number(value.split(".")[1]);
  return Number.isFinite(exp) && exp * 1000 > Date.now();
}

/** Para páginas: redireciona para o login. */
export async function requireAdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** Para actions/rotas: lança erro. */
export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Sessão de admin expirada. Entre de novo.");
}
