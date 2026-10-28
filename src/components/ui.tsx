"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

export type ActionResult = { ok: boolean; error?: string; message?: string } | null;

export function CopyButton({ text, label = "Copiar", className = "btn btn-light btn-sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? "Copiado" : label}
    </button>
  );
}

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText = "Enviando...",
  confirm,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}

/**
 * Formulário ligado a uma server action `(prev, formData) => ActionResult`.
 * Mostra erro/mensagem e atualiza a página quando dá certo.
 */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      if (resetOnSuccess) setFormKey((k) => k + 1);
    }
  }, [state, router, resetOnSuccess]);
  return (
    <form key={formKey} action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p role="alert" className="mt-2 w-full rounded-xl border-2 border-red bg-red/10 px-3 py-2 text-sm font-bold text-red">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.message ? <p className="mt-2 w-full text-sm font-bold">{state.message}</p> : null}
    </form>
  );
}

export function SaveLocal({ storageKey, value }: { storageKey: string; value: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {}
  }, [storageKey, value]);
  return null;
}

/** No hub, se o aparelho já tem o link pessoal salvo, mostra o atalho. */
export function MyPageShortcut({ slug }: { slug: string }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    try {
      setToken(localStorage.getItem(`arena:${slug}:token`));
    } catch {}
  }, [slug]);
  if (!token) return null;
  return (
    <a href={`/t/${slug}/p/${token}`} className="btn btn-primary btn-sm">
      Minha página
    </a>
  );
}

export function ShareWhatsApp({ text, label = "Enviar no WhatsApp" }: { text: string; label?: string }) {
  return (
    <a className="btn btn-neutral btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

/** Caixa do link pessoal: "salva esse link, ele é seu crachá". */
export function PersonalLinkBox({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState(path);
  useEffect(() => setUrl(`${window.location.origin}${path}`), [path]);
  const msg = `Meu crachá da Arena Mormaço (${name}): ${url}`;
  return (
    <div className="space-y-2">
      <p className="break-all rounded-xl border-2 border-navy bg-white px-3 py-2 text-sm">{url}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={url} label="Copiar link" />
        <ShareWhatsApp text={msg} label="Mandar pra mim no WhatsApp" />
      </div>
    </div>
  );
}
