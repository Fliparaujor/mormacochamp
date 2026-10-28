import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/server/db";
import { getTournament, playerByToken } from "@/lib/server/tournament";
import { playerView, type PlayerView } from "@/lib/server/views";
import { Header, Page } from "@/components/brand";
import { Pairings, Section, Standings, StatusBadge } from "@/components/tournament";
import { After, Countdown, LiveUpdater, RoundAlert } from "@/components/live";
import { ActionForm, CopyButton, PersonalLinkBox, SaveLocal, SubmitButton } from "@/components/ui";
import { ReportForm } from "@/components/report-form";
import { JitsiRoom } from "@/components/jitsi";
import { deadlinesOf } from "@/components/hub-parts";
import { checkinAction, deckAction, dropAction, pixAction } from "@/app/actions/player";
import { fmtMoney, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha página", robots: { index: false, follow: false } };

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ novo?: string }>;
}) {
  const { slug, token } = await params;
  const { novo } = await searchParams;
  const db = getDb();
  const player = await playerByToken(db, token).catch(() => null);
  if (!player) notFound();
  const t = await getTournament(db, player.tournament_id);
  if (!t || t.slug !== slug) notFound();
  const v = await playerView(db, player);
  const path = `/t/${slug}/p/${token}`;
  const m = v.match;
  const liveMatch = m && v.hub.round?.status === "live" && m.roundId === v.hub.round.id;

  return (
    <Page>
      <SaveLocal storageKey={`arena:${slug}:token`} value={token} />
      <LiveUpdater tournamentId={t.id} deadlines={deadlinesOf(v.hub)} pollMs={8000} active={!["finished", "cancelled"].includes(t.status)} />
      <Header right={<Link href={`/t/${slug}`} className="btn btn-light btn-sm">Torneio</Link>} />

      <div className="mx-auto mt-3 max-w-xl space-y-5">
        <div>
          <StatusBadge status={v.hub.t.status} />
          <h1 className="font-title mt-2 text-3xl">
            Oi, <span className="highlight">{v.me.name.split(" ")[0]}</span>
          </h1>
          <p className="text-cream/80">
            {v.hub.t.name} · TCG Live: {v.me.tcglive}
          </p>
        </div>

        {novo ? (
          <Section tone="card-butter" title="Salva esse link, ele é seu crachá">
            <p className="mb-3 text-sm">É por ele que você faz check-in, vê sua mesa e reporta resultado. Não passa pra ninguém.</p>
            <PersonalLinkBox path={path} name={v.me.name} />
          </Section>
        ) : null}

        <MainCard v={v} token={token} />

        {liveMatch && m ? <MatchCard v={v} token={token} /> : null}
        {!liveMatch && m && m.result ? <LastResult v={v} /> : null}

        {v.standing ? (
          <Section tone="card-dark">
            <p className="text-lg">
              Você está em <span className="highlight font-title">{v.standing.rank}º</span> com {v.standing.points} pontos ({v.standing.wins + v.standing.byes}-{v.standing.losses}-{v.standing.ties})
            </p>
          </Section>
        ) : null}

        <DeckCard v={v} token={token} />

        {v.hub.round && v.hub.t.status !== "finished" ? (
          <Section title={`${v.hub.round.label}: todas as mesas`}>
            <Pairings round={v.hub.round} highlightId={v.me.id} />
          </Section>
        ) : null}

        {v.hub.standings.length ? (
          <Section title="Classificação">
            <Standings rows={v.hub.standings} highlightId={v.me.id} />
          </Section>
        ) : null}

        {!novo ? (
          <Section title="Seu crachá">
            <PersonalLinkBox path={path} name={v.me.name} />
          </Section>
        ) : null}

        {!v.me.dropped && ["registration", "checkin", "swiss", "topcut"].includes(v.hub.t.status) ? (
          <ActionForm action={dropAction} className="text-center">
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="btn btn-danger btn-sm" confirm="Tem certeza que quer sair do torneio? Não tem volta pelo site.">
              Sair do torneio
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>
    </Page>
  );
}

function MainCard({ v, token }: { v: PlayerView; token: string }) {
  const { me, hub, payment } = v;
  const st = hub.t.status;

  if (me.paymentStatus === "refunded") {
    return <Section tone="card"><p className="text-lg">Seu Pix foi devolvido. Sua inscrição não está mais ativa.</p></Section>;
  }

  if (st === "finished") {
    return <FinishedCard v={v} />;
  }
  if (st === "cancelled") {
    return <Section tone="card"><p className="text-lg">Torneio cancelado. Se você pagou, o Pix volta em até 24h.</p></Section>;
  }

  if (me.dropped) {
    return (
      <Section tone="card">
        <p className="text-lg">Você está fora do torneio{me.dropReason ? ` (${me.dropReason})` : ""}.</p>
        <p className="mt-1 text-sm">Se foi engano, fala com o juiz no grupo.</p>
      </Section>
    );
  }

  if (me.paymentStatus === "pending") {
    return (
      <Section tone="card-butter" title="Falta o Pix">
        <p className="text-lg">
          Valor: <span className="font-title">{fmtMoney(payment.amountCents)}</span>
        </p>
        {payment.mode === "mercadopago" ? (
          <div className="mt-3 space-y-3">
            {payment.qrBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${payment.qrBase64}`} alt="QR Code Pix" className="mx-auto size-56 rounded-xl border-3 border-navy bg-white p-2" />
            ) : null}
            {payment.qrCode ? (
              <div className="space-y-2">
                <p className="break-all rounded-xl border-2 border-navy bg-white p-2 font-mono text-xs">{payment.qrCode}</p>
                <CopyButton text={payment.qrCode} label="Copiar Pix copia e cola" className="btn btn-primary w-full" />
              </div>
            ) : null}
            <ActionForm action={pixAction}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton className="btn btn-light w-full" pendingText="Consultando...">
                {payment.qrCode ? "Já paguei, conferir" : "Gerar Pix"}
              </SubmitButton>
            </ActionForm>
            <p className="text-sm">A confirmação chega sozinha em alguns segundos.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {payment.pixKey ? (
              <div className="space-y-2">
                <p className="text-sm font-bold">Chave Pix</p>
                <p className="break-all rounded-xl border-2 border-navy bg-white px-3 py-2 font-mono">{payment.pixKey}</p>
                <CopyButton text={payment.pixKey} label="Copiar chave Pix" className="btn btn-primary w-full" />
              </div>
            ) : (
              <p>A chave Pix sai no grupo do WhatsApp.</p>
            )}
            <p>
              Depois de pagar, manda o comprovante no direct{" "}
              <a className="link font-bold" href="https://instagram.com/mormacotcg" target="_blank" rel="noreferrer">
                @mormacotcg
              </a>
              .
            </p>
            <p className="chip bg-white">Aguardando confirmação</p>
          </div>
        )}
      </Section>
    );
  }

  if (st === "registration" || st === "draft") {
    return (
      <Section tone="card-butter" title="Inscrição confirmada">
        {hub.t.checkinOpensAt ? (
          <>
            <p>
              Check-in das {fmtTime(hub.t.checkinOpensAt)} às {fmtTime(hub.t.checkinClosesAt)}. Abre em:
            </p>
            <Countdown to={hub.t.checkinOpensAt} serverNow={hub.serverNow} className="font-title block text-5xl" expired={<span className="font-title text-2xl">abrindo...</span>} />
          </>
        ) : (
          <p>O check-in abre no dia. Fica de olho aqui.</p>
        )}
        <p className="mt-2 text-sm">Quem não fizer check-in até o fechamento fica fora, sem devolução.</p>
      </Section>
    );
  }

  if (st === "checkin") {
    return (
      <Section tone="card-butter" title={me.checkedIn ? "Check-in feito" : "Check-in aberto"}>
        {me.checkedIn ? (
          <p className="text-lg">Tudo certo. O pareamento sai quando o check-in fechar{hub.t.checkinClosesAt ? `, às ${fmtTime(hub.t.checkinClosesAt)}` : ""}.</p>
        ) : (
          <ActionForm action={checkinAction} className="space-y-2">
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="btn btn-primary btn-lg w-full text-2xl" pendingText="Confirmando...">
              Fazer check-in
            </SubmitButton>
            {!me.deck.ok ? <p className="text-sm font-bold text-red">Sua lista ainda não tem 60 cartas. Ajusta antes, ela trava no check-in.</p> : null}
          </ActionForm>
        )}
        {hub.t.checkinClosesAt ? (
          <p className="mt-3 text-sm">
            Fecha em <Countdown to={hub.t.checkinClosesAt} serverNow={hub.serverNow} className="font-title" />
          </p>
        ) : null}
      </Section>
    );
  }

  // Suíço / top cut, entre rodadas
  const liveRound = hub.round?.status === "live";
  if (!liveRound) {
    return (
      <Section tone="card-butter">
        {hub.t.nextRoundAt ? (
          <>
            <p className="font-title text-lg">Próxima rodada começa em</p>
            <Countdown to={hub.t.nextRoundAt} serverNow={hub.serverNow} className="font-title block text-5xl" expired={<span className="font-title text-2xl">saindo agora</span>} />
          </>
        ) : (
          <p className="text-lg">Aguardando a próxima rodada.</p>
        )}
        <div className="mt-2">
          <RoundAlert storageKey={`arena:alert:${me.id}`} alertKey={null} message="" />
        </div>
      </Section>
    );
  }
  if (!v.match || v.match.roundId !== hub.round?.id) {
    return <Section tone="card"><p className="text-lg">Você não tem mesa nesta rodada.</p></Section>;
  }
  return null;
}

function MatchCard({ v, token }: { v: PlayerView; token: string }) {
  const m = v.match!;
  const hub = v.hub;
  const isBye = !m.opponent;
  return (
    <>
      <RoundAlert
        storageKey={`arena:alert:${v.me.id}`}
        alertKey={`${m.roundNumber}-${m.table}`}
        message={isBye ? `${m.label}: você está de bye` : `${m.label}: mesa ${m.table} contra ${m.opponent!.name}`}
      />
      <Section tone="card-butter">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-title text-lg">{m.label}</p>
          <p className="font-title text-lg">{m.stage === "topcut" ? m.label : `Mesa ${m.table}`}</p>
        </div>
        {m.endsAt ? (
          <>
            <Countdown
              to={m.endsAt}
              serverNow={hub.serverNow}
              className="font-title block text-6xl"
              expired={<span className="font-title block text-3xl text-red">Tempo acabou</span>}
            />
            <After at={m.endsAt} serverNow={hub.serverNow}>
              <p className="font-bold">Vence quem tem mais cartas de prêmio. Empatou, chama o juiz.</p>
            </After>
            <p className="text-sm">Termina às {fmtTime(m.endsAt)}</p>
          </>
        ) : null}
      </Section>

      <Section title={isBye ? "Você está de bye" : "Seu oponente"}>
        {isBye ? (
          <p>Vitória automática nesta rodada. Descansa e volta pra próxima.</p>
        ) : (
          <div className="space-y-3">
            <p className="font-title text-2xl">{m.opponent!.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-xl border-2 border-navy bg-white px-3 py-1 font-mono">{m.opponent!.tcglive}</span>
              <CopyButton text={m.opponent!.tcglive} label="Copiar nome do Live" />
            </div>
            {m.jitsiRoom ? <JitsiRoom room={m.jitsiRoom} displayName={v.me.name} required={m.roomRequired} /> : null}
          </div>
        )}
      </Section>

      {!isBye ? (
        <Section title="Resultado">
          {m.status === "confirmed" ? (
            <p className="text-lg">
              Confirmado: <span className="highlight font-title">{resultLabel(m.result)}</span>
            </p>
          ) : m.status === "disputed" ? (
            <p className="text-lg">Sua mesa está com o juiz. Aguarda que ele chama no grupo.</p>
          ) : m.canReport ? (
            <>
              {m.myReport ? (
                <p className="mb-3 rounded-xl border-2 border-navy bg-butter px-3 py-2">
                  Você reportou <b>{m.myReport === "win" ? "vitória" : "derrota"}</b>.{" "}
                  {m.opponentReported ? "" : "Esperando seu oponente confirmar. Se ele não reportar, confirma sozinho 5 min depois do fim do tempo."}
                </p>
              ) : m.opponentReported ? (
                <p className="mb-3 font-bold">Seu oponente já reportou. Agora é você.</p>
              ) : null}
              <ReportForm token={token} matchId={m.matchId} myReport={m.myReport} />
            </>
          ) : (
            <p>O reporte desta mesa fechou. O juiz decide.</p>
          )}
        </Section>
      ) : null}
    </>
  );
}

function resultLabel(r: string | null) {
  if (r === "win") return "vitória";
  if (r === "loss") return "derrota";
  if (r === "tie") return "empate";
  if (r === "double_loss") return "derrota dupla";
  return "";
}

function LastResult({ v }: { v: PlayerView }) {
  const m = v.match!;
  return (
    <Section tone="card">
      <p>
        {m.label}: <span className="highlight font-title">{m.opponent ? resultLabel(m.result) : "bye"}</span>
        {m.opponent ? ` contra ${m.opponent.name}` : ""}
      </p>
    </Section>
  );
}

function FinishedCard({ v }: { v: PlayerView }) {
  const p = v.placement;
  const store = process.env.STORE_WHATSAPP?.replace(/\D/g, "");
  if (!p) return <Section tone="card"><p className="text-lg">Torneio encerrado. Valeu por jogar.</p></Section>;
  const msg = `Oi, Mormaço! Sou ${v.me.name} (TCG Live: ${v.me.tcglive}). Fiquei em ${p.place}º no ${v.hub.t.name} e quero resgatar meu crédito de ${fmtMoney(p.prizeCents)}.`;
  return (
    <Section tone="card-butter">
      <p className="font-title text-lg">Fim de torneio</p>
      <p className="font-title text-5xl">
        <span className="highlight">{p.place}º</span> lugar
      </p>
      {p.prizeCents > 0 ? (
        <>
          <p className="mt-2 text-lg">
            Seu prêmio: <b>{fmtMoney(p.prizeCents)}</b> em crédito na loja (60 dias).
          </p>
          <a
            className="btn btn-primary mt-3 w-full"
            href={store ? `https://wa.me/${store}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`}
            target="_blank"
            rel="noreferrer"
          >
            Resgatar crédito
          </a>
        </>
      ) : (
        <p className="mt-2">Valeu por jogar. Te vejo no próximo.</p>
      )}
    </Section>
  );
}

function DeckCard({ v, token }: { v: PlayerView; token: string }) {
  const { me } = v;
  const count = (
    <span className={`chip ${me.deck.ok ? "bg-bubble" : "bg-red text-cream"}`}>
      {me.deck.total} cartas {me.deck.ok ? "ok" : "· precisa de 60"}
    </span>
  );
  if (me.decklistLocked) {
    return (
      <Section title={<span className="flex flex-wrap items-center gap-2">Sua lista {count} <span className="chip bg-white">travada</span></span>}>
        <details>
          <summary className="cursor-pointer font-bold">Ver lista</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-xl border-2 border-navy bg-white p-3 text-xs whitespace-pre-wrap">{me.decklist || "Sem lista"}</pre>
        </details>
      </Section>
    );
  }
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2">Sua lista {count}</span>}>
      <ActionForm action={deckAction} className="space-y-2">
        <input type="hidden" name="token" value={token} />
        <textarea name="decklist" rows={10} defaultValue={me.decklist} className="input font-mono text-xs" placeholder="Cole a exportação do TCG Live" />
        {me.deck.warnings.length ? (
          <ul className="list-disc pl-5 text-sm">
            {me.deck.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <SubmitButton className="btn btn-primary" pendingText="Salvando...">
          Salvar lista
        </SubmitButton>
        <p className="text-xs opacity-75">Editável até o check-in. Deck jogado = lista enviada. A legalidade é conferida pelo juiz.</p>
      </ActionForm>
    </Section>
  );
}
