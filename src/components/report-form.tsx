"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportAction } from "@/app/actions/player";

const MAX_BYTES = 1_000_000;

/** Comprime no aparelho para JPEG de no máximo 1 MB. */
async function compress(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Não consegui abrir essa imagem."));
      i.src = url;
    });
    let maxSide = 1920;
    let quality = 0.82;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return blob;
      quality = Math.max(0.5, quality - 0.1);
      maxSide = Math.round(maxSide * 0.8);
    }
    throw new Error("Não consegui deixar o print abaixo de 1 MB.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ReportForm({ token, matchId, myReport }: { token: string; matchId: string; myReport: "win" | "loss" | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState<"win" | "loss" | null>(myReport);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Escolha uma imagem (print da tela final).");
      return;
    }
    try {
      setBusy(true);
      const b = await compress(f);
      setBlob(b);
      setPreview(URL.createObjectURL(b));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!choice) return setError("Marque se você venceu ou perdeu.");
    if (!blob) return setError("O print da tela final é obrigatório.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("matchId", matchId);
    fd.set("report", choice);
    fd.set("print", new File([blob], "print.jpg", { type: "image/jpeg" }));
    const res = await reportAction(fd);
    setBusy(false);
    if (!res?.ok) return setError(res?.error ?? "Falhou. Tenta de novo.");
    setBlob(null);
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className={`btn btn-lg ${choice === "win" ? "btn-primary" : "btn-light"}`}
          aria-pressed={choice === "win"}
          onClick={() => setChoice("win")}
        >
          Eu venci
        </button>
        <button
          type="button"
          className={`btn btn-lg ${choice === "loss" ? "btn-danger" : "btn-light"}`}
          aria-pressed={choice === "loss"}
          onClick={() => setChoice("loss")}
        >
          Eu perdi
        </button>
      </div>
      <div>
        <span className="label">Print da tela final (obrigatório)</span>
        <label className={`btn btn-neutral w-full ${busy ? "opacity-60" : ""}`}>
          {blob ? "Trocar print" : "Escolher print"}
          <input type="file" accept="image/*" className="sr-only" onChange={onFile} disabled={busy} />
        </label>
      </div>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Prévia do print" className="max-h-56 rounded-xl border-2 border-navy" />
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border-2 border-red bg-red/10 px-3 py-2 text-sm font-bold text-red">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn btn-primary w-full" disabled={busy || !choice || !blob} onClick={submit}>
        {busy ? "Enviando..." : myReport ? "Reenviar resultado" : "Enviar resultado"}
      </button>
      <p className="text-xs opacity-75">Empate só o juiz registra. Se der empate, chama o juiz no grupo.</p>
    </div>
  );
}
