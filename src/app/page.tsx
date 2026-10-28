import Link from "next/link";
import { getDb } from "@/lib/server/db";
import type { TournamentRow } from "@/lib/server/rows";
import { Footer, Header, Page, Title, TournamentTitle } from "@/components/brand";
import { StatusBadge } from "@/components/tournament";
import { fmtDateTime, fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ts = await getDb().query<TournamentRow & { paid: number }>(
    `select t.*, (select count(*)::int from players p where p.tournament_id = t.id and p.payment_status = 'paid') as paid
     from tournaments t where not is_simulation and status <> 'draft' order by starts_at desc limit 30`,
  );
  const active = ts.filter((t) => !["finished", "cancelled"].includes(t.status)).sort((a, b) => +a.starts_at - +b.starts_at);
  const current = active[0];
  const others = ts.filter((t) => t.id !== current?.id);

  return (
    <Page>
      <Header />
      <div className="mt-6 mb-8">
        <Title before="Torneios online da" highlight="Mormaço" className="text-4xl sm:text-5xl" />
        <p className="mt-3 max-w-xl text-lg text-cream/85">Inscrição, check-in, pareamento e resultado, tudo aqui. Você joga no TCG Live.</p>
      </div>

      {current ? (
        <Link href={`/t/${current.slug}`} className="card-butter block p-5 transition-transform hover:-translate-y-0.5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-cream">Próximo torneio</span>
            <StatusBadge status={current.status} />
          </div>
          <TournamentTitle name={current.name} className="mt-3 text-3xl sm:text-4xl" />
          <p className="mt-2 text-lg">{fmtDateTime(current.starts_at)} · {fmtMoney(current.entry_fee_cents)} · {current.paid} inscritos</p>
          <span className="btn btn-primary mt-4">{current.status === "registration" ? "Quero jogar" : "Acompanhar"}</span>
        </Link>
      ) : (
        <div className="card p-6">
          <p className="text-lg">Nenhum torneio aberto agora. Fica de olho no @mormacotcg.</p>
        </div>
      )}

      {others.length ? (
        <section className="mt-10">
          <h2 className="font-title mb-3 text-2xl">Outros torneios</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {others.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.slug}`} className="card block p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-title text-lg">{t.name}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="text-sm">{fmtDateTime(t.starts_at)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Footer />
    </Page>
  );
}
