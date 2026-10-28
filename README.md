# Arena Mormaço

Plataforma de torneios online de Pokémon TCG da Mormaço TCG: inscrição, Pix, lista, check-in, suíço, top cut, resultados com print, classificação e prêmio. Tudo roda sozinho no modo automático; o juiz só entra em disputa.

- **Público:** `/` (torneios), `/t/[slug]` (hub ao vivo), `/t/[slug]/inscricao`, `/t/[slug]/regulamento`, `/t/[slug]/display` (telão)
- **Jogador:** `/t/[slug]/p/[token]` (o link pessoal é o crachá, sem senha)
- **Juiz:** `/admin` (senha única em `ADMIN_PASSWORD`)

Stack: Next.js 15 (App Router, Server Actions) · Postgres do Supabase (conexão direta, transações e advisory lock) · Supabase Storage (prints) · Supabase Realtime (eventos) · Tailwind 4 · Jitsi (meet.jit.si) · Mercado Pago opcional.

---

## 1. Setup

### Supabase
1. Crie um projeto (região `sa-east-1`).
2. **SQL Editor:** cole e rode `schema.sql`. Pode rodar de novo sem perder dados.
3. **SQL Editor:** rode `supabase/cron.sql` trocando `SEU-DOMINIO` e `SEU-CRON-SECRET` (é o cron de 1 em 1 minuto que chama `/api/cron/tick`).
4. O bucket `prints` (privado) é criado sozinho no primeiro upload.

### Vercel
1. Importe o repositório. Framework: Next.js, sem configuração extra.
2. Configure as variáveis abaixo e faça o deploy. A branch `main` publica sozinha.

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Supabase > Connect > **Transaction pooler** (porta 6543). Obrigatória. |
| `ADMIN_PASSWORD` | Senha do `/admin`. |
| `SESSION_SECRET` | Assina o cookie do admin e as URLs de print. String aleatória longa. |
| `CRON_SECRET` | Protege `/api/cron/tick`. O mesmo valor vai no `supabase/cron.sql`. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Upload dos prints no Storage (só no servidor). |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Realtime no navegador. Sem elas as páginas atualizam por polling. |
| `APP_URL` | URL pública (webhook do Mercado Pago). |
| `STORE_WHATSAPP` | WhatsApp da loja para o botão "Resgatar crédito" (ex.: `5585999999999`). |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Opcional. Sem elas o Pix fica manual, sem quebrar nada. |

Modelo em `.env.example`.

### Rodando local
```bash
npm install
cp .env.example .env.local   # ajuste DATABASE_URL e ADMIN_PASSWORD
npm run db:setup             # aplica schema.sql
npm run dev
```
Sem `SUPABASE_*`, os prints vão para a tabela `uploads` do próprio banco e o realtime vira polling.

### Testes
```bash
npm test
```
- `tests/engine.test.ts`: pareamento (8, 9, 12, 16, 17 e 32 jogadores, 25 sorteios cada, sem rematch, bye correto), desempate (OWP com piso, Op-OWP, sorteio), estrutura automática, faixas de prêmio, chave do top cut, as 4 situações de confirmação, parser da lista.
- `tests/simulation.test.ts`: Postgres em memória (PGlite) com o `schema.sql` real. Simulação completa de 12 jogadores (check-in → 4 suíças → top 4 → final → campeão) só com o tick automático, verificando idempotência a cada passo; cancelamento por quórum; reportes, disputa, confirmação por tempo, reversão e re-pareamento.

---

## 2. Criar um torneio

**Pelo admin:** `/admin` → "Novo torneio". Todos os horários são digitados no fuso do torneio (padrão `America/Fortaleza`). Campos vazios de rodadas/top cut = automático.

**Noite Assombrada (pronto):** rode `supabase/noite-assombrada.sql` no SQL Editor e depois, no admin, preencha a chave Pix e o link do grupo em "Configurar". Ou crie pelo formulário:

| Campo | Valor |
|---|---|
| Nome / slug | Noite Assombrada / `noite-assombrada` |
| Início | 31/10/2026 20:00 |
| Check-in | abre 31/10 19:30, fecha 31/10 19:45 |
| Inscrição | 15 · Pix manual · chave Pix da loja |
| Status | Inscrições abertas |
| Modo automático | ligado |

---

## 3. Operar o dia

Com o modo automático ligado, a sequência é:

1. **Antes:** inscritos aparecem em "Inscritos > Aguardando Pix". Bateu o comprovante no direct, clique **Confirmar Pix** (só pago aparece na lista pública e pode fazer check-in).
2. **19:30** o check-in abre sozinho. O jogador aperta "Fazer check-in" na página dele (precisa ter mandado a lista). A lista trava.
3. **19:45** o check-in fecha: quem pagou e não fez check-in sai ("sem check-in"); as seeds são sorteadas; a estrutura é definida (8–15: 4 rodadas + top 4; 16–32: 5 rodadas + top 8); a rodada 1 abre. Menos de 8: torneio cancelado (com Mercado Pago, devolve sozinho; manual, use "Devolver" em cada inscrito).
4. **Cada rodada:** 25 min. Cada jogador marca "Eu venci/Eu perdi" com print obrigatório.
   - os dois concordam → confirmado na hora;
   - discordam → **disputa** (aba Mesas, prints lado a lado);
   - só um reportou → confirma sozinho 5 min após o fim do tempo ("confirmado por tempo");
   - ninguém reportou até 10 min após o fim → vira disputa para o juiz (nunca empate automático).
5. Mesas todas resolvidas → a próxima rodada abre 2 min depois (configurável). No fim do suíço, o top cut é gerado e aberto; depois da final, o torneio encerra e publica pódio e prêmios.

**O que o juiz faz:** aba **Mesas** → disputas ficam em vermelho, com os dois prints (clique para ampliar) e os botões: vitória de um ou outro, empate, derrota dupla, penalidade (derrota), reverter. "Assistir" abre a sala Jitsi da mesa num painel lateral.

**Atalhos da aba Geral:** copiar pareamentos para o WhatsApp, ±minutos no relógio, re-parear/desfazer rodada, abrir próxima rodada à mão, ligar/desligar automático, rodar automatismos agora. Toda ação automática gera evento e pode ser revertida. Aba **Eventos** tem a trilha completa e exportação CSV.

**Modo manual:** desligando o automático, nada acontece por horário; use os botões (abrir/fechar check-in, abrir rodada). Rodadas continuam fechando quando todas as mesas estão resolvidas.

### Simulação
`/admin` → "Iniciar simulação" cria um torneio marcado `is_simulation` com 12 bots pagos. O check-in fecha em 1 minuto e os bots reportam sozinhos; com a página do admin aberta, termina em ~4 minutos. Também dá para criar pelo terminal: `npm run db:seed`. Simulações não aparecem na home e podem ser apagadas no admin.

---

## 4. Regras do motor

**Pontos:** vitória 3, empate 1, derrota 0, bye 3. Derrota dupla é derrota para os dois.

**Desempate**, nesta ordem:
1. Pontos.
2. **OWP**: média do win% dos oponentes enfrentados no suíço. Win% de um jogador = (3·V + E) / (3·partidas jogadas), sem contar byes, com **piso de 25%**. Bye não conta como oponente.
3. **Op-OWP**: média do OWP desses mesmos oponentes.
4. **Sorteio**: a seed sorteada no fechamento do check-in (evento `seeds_drawn`; desempates finais registrados como `lottery_tiebreak`).

**Pareamento suíço:** rodada 1 pela seed sorteada (1×2, 3×4...). Depois, lista ordenada pela classificação; de cima pra baixo cada jogador pega o mais próximo que ainda não enfrentou, então os grupos de pontos se pareiam internamente e o ímpar desce para o grupo seguinte. Se travar, backtracking. O bye vai para o último colocado que ainda não teve bye. Se não houver saída sem repetir oponente, permite rematch e registra `rematch_forced`. Quem saiu não é pareado.

**Top cut:** eliminação simples Bo1, semeado 1×8, 4×5, 2×7, 3×6 (ou 1×4, 2×3). Sem disputa de 3º: quem caiu na mesma fase fica ordenado pela classificação do suíço.

**Prêmio** (crédito na loja, faixa por jogadores com check-in; antes do check-in a página mostra a faixa pelos pagos):
8–11: R$70/40 · 12–19: R$100/45/25 · 20–27: R$140/70/45/25 · 28–32: R$200/100/60/40. Editável em JSON por torneio.

**Automatismos:** `tick` por torneio, dentro de transação com `pg_advisory_xact_lock` (nunca abre duas rodadas, e `unique(tournament_id, number)` garante no banco). Idempotente: rodar duas vezes seguidas não muda nada (coberto no teste). Disparado pelo cron (1/min) e também pelas páginas abertas (a cada 20 s e nos prazos exatos), então os horários batem no segundo mesmo se o cron atrasar.

---

## 5. Segurança

- Token do jogador: 32 caracteres aleatórios (`crypto.randomBytes`), nunca listado em lugar nenhum.
- Todas as mutações por Server Actions validadas com zod. Inscrição com honeypot e limite de 5 por IP a cada 10 min.
- Prints: só JPEG/PNG/WebP, comprimidos no aparelho para no máximo 1 MB, nome aleatório, bucket privado, URL assinada de 1 h.
- RLS **ligado sem políticas** em todas as tabelas (a chave anon não lê nada); o app acessa pelo servidor. A única exceção é leitura de `events` (sem token, WhatsApp ou e-mail) para o Realtime. É o mesmo efeito do "RLS desligado + só service role" pedido, sem expor dados pela chave pública.
- Pix nunca vira "pago" sem evento `payment_confirmed`; no Mercado Pago, só com status `approved` lido da API (o webhook valida `x-signature`).
- Horários salvos em UTC, exibidos em America/Fortaleza.

---

## 6. Limitações conhecidas

- **Jitsi embutido:** o meet.jit.si limita salas embutidas em iframe (aviso e corte após ~5 min sem login). Por isso o botão principal do jogador abre a sala em nova aba/app, que não tem esse limite; o "abrir aqui" e o painel do juiz usam iframe com link "Nova aba" ao lado. Se virar problema, troque para um servidor Jitsi próprio ou JaaS (8x8) em `src/components/jitsi.tsx`.
- **Cron na Vercel Hobby** só roda 1x por dia, por isso o cron fica no Supabase (`supabase/cron.sql`).
- **Logo:** sem `public/logo-mormaco.png`, aparece "MORMAÇO" escrito em Fredoka (TODO em `src/components/brand.tsx`). Basta colocar o arquivo e publicar de novo.

### Fora desta versão (PHASE 2)
- Legalidade da lista (marcas H/I/J): hoje só confere 60 cartas e máximo de 4 cópias; o resto é com o juiz.
- Web Push com o navegador fechado: hoje há som, título da aba piscando e notificação local enquanto a página está aberta (inclusive em segundo plano no Android).
- Mercado Pago está implementado (QR dinâmico, webhook assinado, reembolso no cancelamento por quórum), mas **não foi testado contra a API real** por falta de credenciais. Use manual no primeiro evento.
- WhatsApp automático (sem API viável no prazo): use "Copiar pareamentos".

## 7. Diagnóstico

Abra `https://SEU-DOMINIO/api/health?secret=CRON_SECRET`. A página lista, em português, o que está faltando ou errado: variáveis vazias ou com texto de exemplo, `DATABASE_URL` apontando para a conexão direta em vez do Transaction pooler, erro de senha, tabelas que faltam e se o torneio `noite-assombrada` existe. Ela nunca mostra o valor das variáveis.
