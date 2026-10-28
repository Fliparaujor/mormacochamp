import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { getTournamentBySlug } from "@/lib/server/tournament";
import { registrationOpen } from "@/lib/server/registration";
import { Header, Page, Title } from "@/components/brand";
import { ActionForm, MyPageShortcut, SubmitButton } from "@/components/ui";
import { registerAction } from "@/app/actions/player";
import { fmtDateTime, fmtMoney, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inscrição" };

export default async function Inscricao({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTournamentBySlug(getDb(), slug);
  if (!t || t.status === "draft") notFound();
  const open = registrationOpen(t);

  return (
    <Page>
      <Header right={<MyPageShortcut slug={slug} />} />
      <div className="mx-auto mt-4 max-w-xl">
        <Link href={`/t/${slug}`} className="link text-sm">
          ← {t.name}
        </Link>
        <Title before="Sua" highlight="inscrição" className="mt-3 text-4xl" />
        <p className="mt-2 text-cream/85">
          {fmtDateTime(t.starts_at)} · {fmtMoney(t.entry_fee_cents)} no Pix
          {t.checkin_opens_at ? ` · check-in das ${fmtTime(t.checkin_opens_at)} às ${fmtTime(t.checkin_closes_at)}` : ""}
        </p>

        {!open ? (
          <div className="card mt-6 p-5">
            <p className="text-lg">As inscrições estão fechadas.</p>
          </div>
        ) : (
          <ActionForm action={registerAction} className="card mt-6 space-y-4 p-5">
            <input type="hidden" name="slug" value={slug} />
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            <label className="block">
              <span className="label">Seu nome</span>
              <input name="name" required minLength={2} maxLength={60} className="input" autoComplete="name" />
            </label>
            <label className="block">
              <span className="label">Nome no TCG Live</span>
              <input name="tcgliveName" required minLength={2} maxLength={40} className="input" autoCapitalize="none" autoCorrect="off" />
              <span className="mt-1 block text-xs opacity-75">Exatamente como aparece no jogo. É assim que seu oponente te acha.</span>
            </label>
            <label className="block">
              <span className="label">WhatsApp com DDD</span>
              <input name="whatsapp" required inputMode="tel" placeholder="(85) 9 9999-9999" className="input" autoComplete="tel" />
            </label>
            <label className="block">
              <span className="label">E-mail (opcional)</span>
              <input name="email" type="email" className="input" autoComplete="email" />
            </label>
            <label className="block">
              <span className="label">Lista do deck (opcional agora)</span>
              <textarea
                name="decklist"
                rows={8}
                className="input font-mono text-xs"
                placeholder={"Cole aqui a exportação do TCG Live\nPokémon: 12\n4 Dreepy TWM 128\n..."}
              />
              <span className="mt-1 block text-xs opacity-75">Pode mandar depois, pela sua página, até o check-in. No check-in a lista trava.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="accept" required className="mt-1 size-5 accent-[#272D67]" />
              <span className="text-sm">
                Li e aceito o{" "}
                <Link href={`/t/${slug}/regulamento`} className="link" target="_blank">
                  regulamento
                </Link>
                .
              </span>
            </label>
            <SubmitButton className="btn btn-primary btn-lg w-full" pendingText="Inscrevendo...">
              Fazer inscrição
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </Page>
  );
}
