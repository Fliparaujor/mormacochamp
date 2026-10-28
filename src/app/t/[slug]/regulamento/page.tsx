import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { getTournamentBySlug } from "@/lib/server/tournament";
import { Header, Page } from "@/components/brand";
import { Markdown } from "@/components/markdown";
import { DEFAULT_RULES_MD } from "@/lib/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Regulamento" };

export default async function Regulamento({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTournamentBySlug(getDb(), slug);
  if (!t) notFound();
  return (
    <Page>
      <Header />
      <div className="mx-auto mt-4 max-w-2xl">
        <Link href={`/t/${slug}`} className="link text-sm">
          ← {t.name}
        </Link>
        <article className="card mt-4 p-5 sm:p-7">
          <Markdown text={t.rules_md || DEFAULT_RULES_MD} />
          {t.rules_url ? (
            <p className="mt-6">
              <a href={t.rules_url} className="link" target="_blank" rel="noreferrer">
                Regulamento completo
              </a>
            </p>
          ) : null}
        </article>
      </div>
    </Page>
  );
}
