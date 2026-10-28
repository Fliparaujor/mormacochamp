import type { MatchResult, Report, Stage } from "@/lib/engine/types";
import type { PrizeBand } from "@/lib/engine/structure";

export type TournamentStatus = "draft" | "registration" | "checkin" | "swiss" | "topcut" | "finished" | "cancelled";

export interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  starts_at: Date;
  timezone: string;
  format: string;
  best_of: number;
  round_minutes: number;
  min_players: number;
  max_players: number;
  entry_fee_cents: number;
  pix_key: string | null;
  pix_mode: "manual" | "mercadopago";
  status: TournamentStatus;
  checkin_opens_at: Date | null;
  checkin_closes_at: Date | null;
  auto_mode: boolean;
  auto_next_round_delay_seconds: number;
  swiss_rounds: number | null;
  topcut_size: number | null;
  rules_url: string | null;
  rules_md: string | null;
  whatsapp_group_url: string | null;
  prize_table: PrizeBand[] | null;
  room_required_topcut: boolean;
  room_required_swiss: boolean;
  next_round_at: Date | null;
  is_simulation: boolean;
  created_at: Date;
}

export interface PlayerRow {
  id: string;
  tournament_id: string;
  token: string;
  name: string;
  tcglive_name: string;
  whatsapp: string;
  email: string | null;
  payment_status: "pending" | "paid" | "refunded";
  payment_ref: string | null;
  checked_in: boolean;
  checked_in_at: Date | null;
  dropped: boolean;
  drop_reason: string | null;
  decklist_text: string | null;
  decklist_json: unknown;
  decklist_locked: boolean;
  seed: number | null;
  is_bot: boolean;
  created_at: Date;
}

export interface RoundRow {
  id: string;
  tournament_id: string;
  number: number;
  stage: Stage;
  started_at: Date | null;
  ends_at: Date | null;
  closed_at: Date | null;
  status: "pending" | "live" | "closed";
}

export interface MatchRow {
  id: string;
  round_id: string;
  table_number: number;
  p1_id: string | null;
  p2_id: string | null;
  result: MatchResult | null;
  result_source: "both" | "admin" | "auto" | "bye" | null;
  p1_report: Report | null;
  p2_report: Report | null;
  p1_print_url: string | null;
  p2_print_url: string | null;
  reported_at: Date | null;
  confirmed_at: Date | null;
  disputed: boolean;
  judge_note: string | null;
  jitsi_room: string | null;
}

export interface EventRow {
  id: number;
  tournament_id: string;
  type: string;
  payload: Record<string, any>;
  created_at: Date;
}
