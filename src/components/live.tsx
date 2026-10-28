"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

function useServerClock(serverNow: string) {
  // Diferença entre o relógio do servidor e o do aparelho (o cronômetro segue o servidor).
  const offset = useMemo(() => new Date(serverNow).getTime() - Date.now(), [serverNow]);
  const [now, setNow] = useState(() => new Date(serverNow).getTime());
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(id);
  }, [offset]);
  return now;
}

export function formatRemaining(ms: number, long = false): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}min`;
  if (h > 0 || long) return `${h}h ${pad(m)}min ${pad(s)}s`;
  return `${pad(m)}:${pad(s)}`;
}

export function Countdown({
  to,
  serverNow,
  className = "",
  expired,
  long = false,
}: {
  to: string;
  serverNow: string;
  className?: string;
  expired?: React.ReactNode;
  long?: boolean;
}) {
  const now = useServerClock(serverNow);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0 && expired) return <>{expired}</>;
  return (
    <span className={`tabular ${className}`} suppressHydrationWarning>
      {formatRemaining(ms, long)}
    </span>
  );
}

/** Mostra o conteúdo só depois do instante `at` (ex.: aviso de tempo esgotado). */
export function After({ at, serverNow, children, before }: { at: string; serverNow: string; children: React.ReactNode; before?: React.ReactNode }) {
  const now = useServerClock(serverNow);
  return <>{now >= new Date(at).getTime() ? children : before ?? null}</>;
}

/**
 * Mantém a página ao vivo: Realtime do Supabase (eventos do torneio), polling de reserva,
 * e dispara o tick dos automatismos enquanto alguém está com a página aberta.
 */
export function LiveUpdater({
  tournamentId,
  deadlines = [],
  pollMs,
  active = true,
}: {
  tournamentId: string;
  deadlines?: Array<string | null | undefined>;
  pollMs?: number;
  active?: boolean;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineKey = deadlines.filter(Boolean).join("|");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => !cancelled && router.refresh(), 350);
    };
    const tick = () =>
      fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: tournamentId }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j?.steps > 0) refresh();
        })
        .catch(() => {});

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let cleanupRealtime: (() => void) | null = null;
    if (url && key) {
      import("@supabase/supabase-js").then(({ createClient }) => {
        if (cancelled) return;
        const sb = createClient(url, key, { auth: { persistSession: false } });
        const ch = sb
          .channel(`t-${tournamentId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "events", filter: `tournament_id=eq.${tournamentId}` },
            () => refresh(),
          )
          .subscribe();
        cleanupRealtime = () => {
          sb.removeChannel(ch);
        };
      });
    }

    tick();
    const tickId = setInterval(() => document.visibilityState === "visible" && tick(), 20_000);
    const pollId = setInterval(
      () => document.visibilityState === "visible" && refresh(),
      pollMs ?? (url && key ? 45_000 : 10_000),
    );
    const onVis = () => {
      if (document.visibilityState === "visible") {
        tick();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const timeouts: Array<ReturnType<typeof setTimeout>> = [];
    for (const d of deadlineKey.split("|").filter(Boolean)) {
      const ms = new Date(d).getTime() - Date.now();
      if (ms > -1000 && ms < 3 * 3600_000) {
        timeouts.push(setTimeout(() => tick().then(refresh), Math.max(0, ms) + 1500));
      }
    }

    return () => {
      cancelled = true;
      clearInterval(tickId);
      clearInterval(pollId);
      timeouts.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVis);
      cleanupRealtime?.();
    };
  }, [tournamentId, deadlineKey, pollMs, active, router]);

  return null;
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    o.stop(ctx.currentTime + 0.55);
  } catch {}
}

/** Alerta quando sai pareamento novo: som curto, título da aba piscando e notificação (se permitida). */
export function RoundAlert({ storageKey, alertKey, message }: { storageKey: string; alertKey: string | null; message: string }) {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (!alertKey) return;
    let prev: string | null = null;
    try {
      prev = localStorage.getItem(storageKey);
      localStorage.setItem(storageKey, alertKey);
    } catch {}
    if (prev === null || prev === alertKey) return;
    beep();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      navigator.serviceWorker?.getRegistration().then((reg) => {
        if (reg) reg.showNotification("Arena Mormaço", { body: message, tag: alertKey, icon: "/icon.svg" });
        else new Notification("Arena Mormaço", { body: message });
      });
    }
    const original = document.title;
    let on = false;
    const id = setInterval(() => {
      document.title = on ? original : `🔔 ${message}`;
      on = !on;
    }, 900);
    const stop = () => {
      clearInterval(id);
      document.title = original;
    };
    const onFocus = () => document.visibilityState === "visible" && setTimeout(stop, 4000);
    document.addEventListener("visibilitychange", onFocus);
    const auto = setTimeout(stop, 60_000);
    return () => {
      stop();
      clearTimeout(auto);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [alertKey, storageKey, message]);

  if (perm !== "default") return null;
  return (
    <button
      type="button"
      className="btn btn-light btn-sm"
      onClick={() => Notification.requestPermission().then((p) => setPerm(p))}
    >
      Avisar quando sair minha mesa
    </button>
  );
}
