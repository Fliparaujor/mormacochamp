import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { requireAdminPage } from "@/lib/server/auth";
import type { TournamentRow } from "@/lib/server/rows";
import { Header, Page, Title } from "@/components/brand";
import { StatusBadge } from "@/components/tournament";
import { ActionForm, SubmitButton } from "@/components/ui";
import { TournamentForm } from "@/components/admin/tournament-form";
import { logoutAction, startSimulationAction } from "@/app/actions/admin";
import { mpEnabled } from "@/lib/server/payments";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminHome() {
  await requireAdminPage();
  const ts = await getDb().query<TournamentRow & { players: number }>(
    `select t.*, (select count(*)::int from players p where p.tournament_id = t.id) as players
     from tournaments t order by is_simulation, starts_at desc limit 60`,
  );
  const real = ts.filter((t) => !t.is_simulation);
  const sims = ts.filter((t) => t.is_simulation);
  return (
    <Page>
      <Header
        right={
          <form action={logoutAction}>
            <button className="btn btn-light btn-sm">Sair</button>
          </form>
        }
      />
      <Title before="Painel do" highlight="juiz" className="mt-4 text-4xl" />

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        {real.map((t) => (
          <Link key={t.id} href={`/admin/t/${t.id}`} className="card block p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-title text-lg">{t.name}</span>
              <StatusBadge status={t.status} />
            </div>
            <p className="text-sm">
              {fmtDateTime(t.starts_at)} · {t.players} inscritos · /t/{t.slug}
            </p>
          </Link>
        ))}
        {!real.length ? <p className="text-cream/80">Nenhum torneio ainda. Crie o primeiro abaixo.</p> : null}
      </section>

      <section className="card-butter mt-8 p-5">
        <h2 className="font-title text-2xl">Modo simulação</h2>
        <p className="mt-1 text-sm">
          Cria um torneio marcado como simulação com jogadores fictícios e roda tudo sozinho: check-in em 1 minuto, rodadas com resultados aleatórios, top cut e campeão. Não mexe nos torneios reais.
        </p>
        <ActionForm action={startSimulationAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <span className="label">Jogadores</span>
            <input name="players" type="number" min={4} max={16} defaultValue={12} className="input w-28" />
          </label>
          <SubmitButton pendingText="Criando...">Iniciar simulação</SubmitButton>
        </ActionForm>
        {sims.length ? (
          <ul className="mt-4 space-y-1 text-sm">
            {sims.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <StatusBadge status={t.status} />
                <Link href={`/admin/t/${t.id}`} className="link">
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card mt-8 p-5">
        <h2 className="font-title mb-4 text-2xl">Novo torneio</h2>
        <TournamentForm mpAvailable={mpEnabled()} />
      </section>
    </Page>
  );
}
