-- Arena Mormaço · schema
-- Rode uma vez no SQL Editor do Supabase (ou `npm run db:setup` com DATABASE_URL).
-- Idempotente: pode rodar de novo sem perder dados.


create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  starts_at timestamptz not null,
  timezone text not null default 'America/Fortaleza',
  format text not null default 'standard',
  best_of int not null default 1,
  round_minutes int not null default 25,
  min_players int not null default 8,
  max_players int not null default 32,
  entry_fee_cents int not null default 1500,
  pix_key text,
  pix_mode text not null default 'manual' check (pix_mode in ('manual','mercadopago')),
  status text not null default 'draft'
    check (status in ('draft','registration','checkin','swiss','topcut','finished','cancelled')),
  checkin_opens_at timestamptz,
  checkin_closes_at timestamptz,
  auto_mode boolean not null default true,
  auto_next_round_delay_seconds int not null default 120,
  swiss_rounds int,
  topcut_size int,
  rules_url text,
  rules_md text,
  whatsapp_group_url text,
  prize_table jsonb,
  room_required_topcut boolean not null default true,
  room_required_swiss boolean not null default false,
  next_round_at timestamptz,
  is_simulation boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  token text not null unique,
  name text not null,
  tcglive_name text not null,
  whatsapp text not null,
  email text,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','refunded')),
  payment_ref text,
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  dropped boolean not null default false,
  drop_reason text,
  decklist_text text,
  decklist_json jsonb,
  decklist_locked boolean not null default false,
  seed int,
  reg_ip_hash text,
  is_bot boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists players_tournament_idx on players(tournament_id);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  number int not null,
  stage text not null check (stage in ('swiss','topcut')),
  started_at timestamptz,
  ends_at timestamptz,
  closed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','live','closed')),
  unique (tournament_id, number)
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  table_number int not null,
  p1_id uuid references players(id) on delete set null,
  p2_id uuid references players(id) on delete set null,
  result text check (result in ('p1','p2','tie','double_loss')),
  result_source text check (result_source in ('both','admin','auto','bye')),
  p1_report text check (p1_report in ('win','loss')),
  p2_report text check (p2_report in ('win','loss')),
  p1_print_url text,
  p2_print_url text,
  reported_at timestamptz,
  confirmed_at timestamptz,
  disputed boolean not null default false,
  judge_note text,
  jitsi_room text,
  unique (round_id, table_number)
);
create index if not exists matches_round_idx on matches(round_id);

create table if not exists standings_cache (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  rank int not null,
  match_points int not null,
  wins int not null,
  losses int not null,
  ties int not null,
  byes int not null,
  owp double precision not null,
  oowp double precision not null,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

create table if not exists events (
  id bigserial primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_tournament_idx on events(tournament_id, id desc);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  provider text not null,
  external_id text,
  qr_code text,
  qr_base64 text,
  amount_cents int not null,
  status text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payments_player_idx on payments(player_id);

-- Fallback de armazenamento de prints quando o Supabase Storage não está configurado (dev local).
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

-- Segurança: o app acessa o banco só pelo servidor (conexão direta / service role).
-- RLS ligado e SEM políticas = a chave anon pública não lê nada destas tabelas.
-- Única exceção: leitura de `events` (sem dados sensíveis) para o Realtime do navegador.
alter table tournaments enable row level security;
alter table players enable row level security;
alter table rounds enable row level security;
alter table matches enable row level security;
alter table standings_cache enable row level security;
alter table payments enable row level security;
alter table uploads enable row level security;
alter table events enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if not exists (select 1 from pg_policies where tablename = 'events' and policyname = 'events_public_read') then
      execute 'create policy events_public_read on events for select to anon, authenticated using (true)';
    end if;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events'
    ) then
      execute 'alter publication supabase_realtime add table events';
    end if;
  end if;
end $$;
