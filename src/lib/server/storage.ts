import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "./db";
import { sign, safeEqual } from "./auth";

const BUCKET = process.env.SUPABASE_PRINTS_BUCKET || "prints";
export const MAX_PRINT_BYTES = 1024 * 1024 + 64 * 1024; // 1 MB + folga de cabeçalho

let client: SupabaseClient | null = null;
let bucketReady = false;

export function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

async function ensureBucket(sb: SupabaseClient) {
  if (bucketReady) return;
  const { data } = await sb.storage.getBucket(BUCKET);
  if (!data) {
    await sb.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_PRINT_BYTES,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
  }
  bucketReady = true;
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Salva o print e devolve uma referência (sb:caminho ou db:uuid). Nome sempre aleatório. */
export async function savePrint(db: Db, file: File, folder: string): Promise<string> {
  if (!ALLOWED.has(file.type)) throw new Error("O print precisa ser uma imagem (JPG, PNG ou WebP).");
  if (file.size > MAX_PRINT_BYTES) throw new Error("O print passou de 1 MB. Tenta de novo que o app comprime.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(bytes)) throw new Error("Arquivo não parece uma imagem.");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const sb = supabaseAdmin();
  if (sb) {
    await ensureBucket(sb);
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
    if (error) throw new Error(`Falha ao salvar o print: ${error.message}`);
    return `sb:${path}`;
  }
  const [row] = await db.query<{ id: string }>("insert into uploads (content_type, data) values ($1, $2) returning id", [
    file.type,
    bytes,
  ]);
  return `db:${row.id}`;
}

/** URL temporária para ver o print (1h). */
export async function printUrl(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  if (ref.startsWith("sb:")) {
    const sb = supabaseAdmin();
    if (!sb) return null;
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(ref.slice(3), 3600);
    return data?.signedUrl ?? null;
  }
  if (ref.startsWith("db:")) {
    const id = ref.slice(3);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return `/api/print/${id}?exp=${exp}&sig=${sign(`print.${id}.${exp}`)}`;
  }
  return null;
}

export function verifyPrintSig(id: string, exp: string, sig: string): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  try {
    return safeEqual(sig, sign(`print.${id}.${exp}`));
  } catch {
    return false;
  }
}

function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8) return true; // jpeg
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // png
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return true;
  return false;
}
