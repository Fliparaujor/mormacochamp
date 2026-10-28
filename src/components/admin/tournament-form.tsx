import type { TournamentRow } from "@/lib/server/rows";
import { ActionForm, SubmitButton } from "@/components/ui";
import { createTournamentAction, updateTournamentAction } from "@/app/actions/admin";
import { utcToZonedLocal } from "@/lib/format";
import { DEFAULT_PRIZE_TABLE } from "@/lib/engine/structure";
import { DEFAULT_RULES_MD } from "@/lib/rules";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs opacity-75">{hint}</span> : null}
    </label>
  );
}

export function TournamentForm({ t, mpAvailable }: { t?: TournamentRow; mpAvailable: boolean }) {
  const tz = t?.timezone ?? "America/Fortaleza";
  const local = (d: Date | null | undefined) => (d ? utcToZonedLocal(d, tz) : "");
  return (
    <ActionForm action={t ? updateTournamentAction : createTournamentAction} className="space-y-5">
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <input name="name" required defaultValue={t?.name ?? ""} placeholder="Noite Assombrada" className="input" />
        </Field>
        <Field label="Slug (endereço)" hint="/t/slug · só minúsculas, números e hífen">
          <input name="slug" required defaultValue={t?.slug ?? ""} placeholder="noite-assombrada" className="input" />
        </Field>
        <Field label="Início" hint={`Horário de ${tz}`}>
          <input name="starts_at" type="datetime-local" required defaultValue={local(t?.starts_at)} className="input" />
        </Field>
        <Field label="Fuso">
          <input name="timezone" defaultValue={tz} className="input" />
        </Field>
        <Field label="Check-in abre">
          <input name="checkin_opens_at" type="datetime-local" defaultValue={local(t?.checkin_opens_at)} className="input" />
        </Field>
        <Field label="Check-in fecha">
          <input name="checkin_closes_at" type="datetime-local" defaultValue={local(t?.checkin_closes_at)} className="input" />
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={t?.status ?? "registration"} className="input">
            <option value="draft">Rascunho (escondido)</option>
            <option value="registration">Inscrições abertas</option>
            <option value="checkin">Check-in aberto</option>
            <option value="swiss">Suíço</option>
            <option value="topcut">Top cut</option>
            <option value="finished">Encerrado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </Field>
        <Field label="Formato">
          <input name="format" defaultValue={t?.format ?? "standard"} className="input" />
        </Field>
        <Field label="Melhor de">
          <input name="best_of" type="number" min={1} max={3} defaultValue={t?.best_of ?? 1} className="input" />
        </Field>
        <Field label="Minutos por rodada">
          <input name="round_minutes" type="number" min={1} max={120} defaultValue={t?.round_minutes ?? 25} className="input" />
        </Field>
        <Field label="Mínimo de jogadores" hint="Menos que isso no fechamento do check-in: cancela">
          <input name="min_players" type="number" min={2} defaultValue={t?.min_players ?? 8} className="input" />
        </Field>
        <Field label="Máximo de jogadores">
          <input name="max_players" type="number" min={2} defaultValue={t?.max_players ?? 32} className="input" />
        </Field>
        <Field label="Inscrição (R$)">
          <input name="entry_fee" inputMode="decimal" defaultValue={((t?.entry_fee_cents ?? 1500) / 100).toString().replace(".", ",")} className="input" />
        </Field>
        <Field label="Chave Pix">
          <input name="pix_key" defaultValue={t?.pix_key ?? ""} className="input" />
        </Field>
        <Field label="Modo do Pix" hint={mpAvailable ? "Mercado Pago configurado" : "MP_ACCESS_TOKEN ausente: Mercado Pago cai no manual"}>
          <select name="pix_mode" defaultValue={t?.pix_mode ?? "manual"} className="input">
            <option value="manual">Manual (admin confirma)</option>
            <option value="mercadopago">Mercado Pago (QR dinâmico)</option>
          </select>
        </Field>
        <Field label="Intervalo entre rodadas (segundos)">
          <input name="auto_next_round_delay_seconds" type="number" min={0} defaultValue={t?.auto_next_round_delay_seconds ?? 120} className="input" />
        </Field>
        <Field label="Rodadas suíças" hint="Vazio = automático (8–15: 4 · 16–32: 5)">
          <input name="swiss_rounds" type="number" min={1} defaultValue={t?.swiss_rounds ?? ""} className="input" />
        </Field>
        <Field label="Top cut" hint="Vazio = automático (8–15: top 4 · 16–32: top 8) · 0 = sem corte">
          <input name="topcut_size" type="number" min={0} max={16} defaultValue={t?.topcut_size ?? ""} className="input" />
        </Field>
        <Field label="Link do grupo do WhatsApp">
          <input name="whatsapp_group_url" defaultValue={t?.whatsapp_group_url ?? ""} className="input" />
        </Field>
        <Field label="Link do regulamento externo (opcional)">
          <input name="rules_url" defaultValue={t?.rules_url ?? ""} className="input" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" name="auto_mode" defaultChecked={t?.auto_mode ?? true} className="size-5" /> Modo automático
        </label>
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" name="room_required_topcut" defaultChecked={t?.room_required_topcut ?? true} className="size-5" /> Sala obrigatória no top cut
        </label>
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" name="room_required_swiss" defaultChecked={t?.room_required_swiss ?? false} className="size-5" /> Sala obrigatória no suíço
        </label>
      </div>
      <Field label="Tabela de prêmio (JSON, centavos)" hint="Faixa por jogadores com check-in">
        <textarea
          name="prize_table"
          rows={5}
          defaultValue={JSON.stringify(t?.prize_table ?? DEFAULT_PRIZE_TABLE)}
          className="input font-mono text-xs"
        />
      </Field>
      <Field label="Regulamento (markdown)">
        <textarea name="rules_md" rows={12} defaultValue={t?.rules_md ?? DEFAULT_RULES_MD} className="input font-mono text-xs" />
      </Field>
      <SubmitButton className="btn btn-primary" pendingText="Salvando...">
        {t ? "Salvar torneio" : "Criar torneio"}
      </SubmitButton>
    </ActionForm>
  );
}
