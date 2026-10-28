"use client";

import { useState } from "react";

export function jitsiUrl(room: string, displayName?: string) {
  const cfg = [
    "config.startWithAudioMuted=true",
    "config.startWithVideoMuted=true",
    "config.prejoinConfig.enabled=false",
    "config.disableDeepLinking=true",
    displayName ? `userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}` : null,
  ]
    .filter(Boolean)
    .join("&");
  return `https://meet.jit.si/${room}#${cfg}`;
}

/** Sala da mesa: abre o Jitsi numa aba nova (melhor no celular) ou embutido aqui. */
export function JitsiRoom({ room, displayName, required }: { room: string; displayName: string; required: boolean }) {
  const [embed, setEmbed] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-neutral" href={`https://meet.jit.si/${room}`} target="_blank" rel="noreferrer">
          Entrar na sala da mesa
        </a>
        <button type="button" className="btn btn-light btn-sm" onClick={() => setEmbed((v) => !v)}>
          {embed ? "Fechar sala aqui" : "Abrir aqui na página"}
        </button>
      </div>
      <p className="text-sm">
        {required ? "Sala obrigatória nesta fase. " : "Sala opcional no suíço, o juiz pode chamar em disputa. "}
        Compartilhe a tela do Live; sem áudio obrigatório.
      </p>
      {embed ? (
        <iframe
          title="Sala da mesa"
          src={jitsiUrl(room, displayName)}
          allow="camera; microphone; display-capture; fullscreen; autoplay"
          className="aspect-video w-full rounded-xl border-3 border-navy bg-navy"
        />
      ) : null}
    </div>
  );
}
