import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  if (process.env.NEXT_PUBLIC_HAS_LOGO) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo-mormaco.png" alt="Mormaço TCG" className={`h-9 w-auto ${className}`} />;
  }
  // TODO: colocar o arquivo oficial em public/logo-mormaco.png (não redesenhar o logo).
  return <span className={`font-title text-2xl tracking-wide text-cream ${className}`}>MORMAÇO</span>;
}

export function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 pt-4 pb-2">
      <Link href="/" className="flex items-center gap-2" aria-label="Arena Mormaço, início">
        <Logo />
        <span className="chip border-cream text-cream">ARENA</span>
      </Link>
      {right}
    </header>
  );
}

/** Título com palavra-chave destacada: <Title before="Noite" highlight="Assombrada" /> */
export function Title({
  before,
  highlight,
  after,
  as: Tag = "h1",
  className = "",
}: {
  before?: string;
  highlight: string;
  after?: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <Tag className={`font-title leading-tight ${className}`}>
      {before ? `${before} ` : null}
      <span className="highlight">{highlight}</span>
      {after ? ` ${after}` : null}
    </Tag>
  );
}

/** Divide o nome do torneio: última palavra vira destaque. */
export function TournamentTitle({ name, className = "" }: { name: string; className?: string }) {
  const parts = name.trim().split(/\s+/);
  const highlight = parts.pop() ?? name;
  return <Title before={parts.join(" ") || undefined} highlight={highlight} className={className} />;
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="halftone min-h-dvh">
      <main className={`mx-auto ${wide ? "max-w-6xl" : "max-w-5xl"} px-4 pb-16`}>{children}</main>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-12 text-sm text-cream/70">
      Arena Mormaço · Mormaço TCG ·{" "}
      <a className="link" href="https://instagram.com/mormacotcg" target="_blank" rel="noreferrer">
        @mormacotcg
      </a>
    </footer>
  );
}
