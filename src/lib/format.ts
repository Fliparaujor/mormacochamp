export const TZ = "America/Fortaleza";

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type D = Date | string | number | null | undefined;
const toDate = (d: D) => (d === null || d === undefined ? null : d instanceof Date ? d : new Date(d));

/** "21:05" */
export function fmtTime(d: D): string {
  const x = toDate(d);
  return x ? timeFmt.format(x) : "";
}

/** "21h05" (formato do texto do WhatsApp) */
export function fmtHour(d: D): string {
  return fmtTime(d).replace(":", "h");
}

/** "sáb., 31/10 · 20:00" */
export function fmtDateTime(d: D): string {
  const x = toDate(d);
  if (!x) return "";
  return `${dateFmt.format(x)} · ${timeFmt.format(x)}`;
}

export function fmtFull(d: D): string {
  const x = toDate(d);
  return x ? fullFmt.format(x) : "";
}

/** R$ 15 ou R$ 15,50 */
export function fmtMoney(cents: number): string {
  const v = cents / 100;
  return Number.isInteger(v) ? `R$ ${v}` : `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/** Converte "2026-10-31T20:00" no fuso dado para Date (UTC). */
export function zonedLocalToUtc(local: string, tz: string = TZ): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error("data inválida");
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = tzOffsetMs(new Date(guess), tz);
  const first = guess - offset;
  // Ajuste para transições de horário de verão
  const offset2 = tzOffsetMs(new Date(first), tz);
  return new Date(guess - offset2);
}

/** Date → "2026-10-31T20:00" no fuso dado (para inputs datetime-local). */
export function utcToZonedLocal(d: D, tz: string = TZ): string {
  const x = toDate(d);
  if (!x) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(x);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

export function record(w: number, l: number, t: number): string {
  return `${w}-${l}-${t}`;
}
