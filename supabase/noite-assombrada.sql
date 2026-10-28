-- Cria o torneio "Noite Assombrada" (rode uma vez; não duplica).
-- Sábado 31/10/2026 20:00 em Fortaleza (UTC-3) = 23:00 UTC. Check-in 19:30–19:45.
insert into tournaments (
  slug, name, starts_at, timezone, format, best_of, round_minutes, min_players, max_players,
  entry_fee_cents, pix_key, pix_mode, status, checkin_opens_at, checkin_closes_at,
  auto_mode, auto_next_round_delay_seconds
) values (
  'noite-assombrada', 'Noite Assombrada', '2026-10-31 20:00:00-03', 'America/Fortaleza', 'standard', 1, 25, 8, 32,
  1500, null, 'manual', 'registration', '2026-10-31 19:30:00-03', '2026-10-31 19:45:00-03',
  true, 120
) on conflict (slug) do nothing;
