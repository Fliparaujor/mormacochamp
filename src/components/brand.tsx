import Link from "next/link";

/** Logo oficial (arquivo da marca, sem redesenho). `size="lg"` usa a versão em alta. */
export function Logo({ className = "", size = "sm" }: { className?: string; size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={lg ? "/logo-mormaco.png" : "/logo-mormaco-sm.png"}
      alt="Mormaço TCG"
      width={lg ? 640 : 240}
      height={lg ? 471 : 177}
      className={`${lg ? "h-28 sm:h-36" : "h-14"} w-auto ${className}`}
    />
  );
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
