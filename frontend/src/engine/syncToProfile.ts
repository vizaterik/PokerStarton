/**
 * Push locally parsed hands into the active profile hand database.
 * Server stores rows only — no HH parse on the backend.
 */

import {
  listHandDatabases,
  MAX_HANDS_PER_ANALYSIS,
  MAX_HANDS_PER_DATABASE,
  syncClientHands,
  type ClientHandsSyncResponse,
} from "../api/client";
import { listHandsForStrategy, type HandRow } from "./localDb";
import { parseHandHistory } from "./parseHh";
import type { ProgressPayload } from "./types";

const CHUNK = 80;

type SyncedHandPayload = {
  external_hand_id: string;
  raw_text: string;
  played_at: string | null;
  table_name: string | null;
  small_blind: number | null;
  big_blind: number | null;
  hero_name: string | null;
  hero_position: string | null;
  hero_hand: string | null;
  hero_hand_code: string | null;
  detected_spot: string | null;
  villain_position: string | null;
  stack_bb: number | null;
  hero_preflop_action: string | null;
  hero_net: number | null;
  hero_net_bb: number | null;
  went_to_showdown: boolean;
  hero_net_wsd: number | null;
  hero_net_wsd_bb: number | null;
  hero_net_wwsd: number | null;
  hero_net_wwsd_bb: number | null;
  actions: {
    street: string;
    action_order: number;
    player_name: string;
    is_hero: boolean;
    action: string;
    amount: number | null;
  }[];
};

function rowToPayload(row: HandRow): SyncedHandPayload | null {
  const raw = (row.raw_text || "").trim();
  if (!raw || !row.external_hand_id) return null;

  let actions: SyncedHandPayload["actions"] = [];
  let stack_bb: number | null = null;
  try {
    const parsed = parseHandHistory(raw)[0];
    if (parsed) {
      actions = parsed.actions.map((a) => ({
        street: a.street,
        action_order: a.action_order,
        player_name: a.player_name,
        is_hero: a.is_hero,
        action: a.action,
        amount: a.amount,
      }));
      stack_bb = parsed.stack_bb;
    }
  } catch {
    /* keep empty actions — hand still stored for career */
  }

  return {
    external_hand_id: row.external_hand_id,
    raw_text: raw,
    played_at: row.played_at,
    table_name: row.table_name,
    small_blind: row.small_blind,
    big_blind: row.big_blind,
    hero_name: row.hero_name,
    hero_position: row.hero_position,
    hero_hand: row.hero_hand,
    hero_hand_code: row.hero_hand_code,
    detected_spot: row.detected_spot,
    villain_position: row.villain_position,
    stack_bb,
    hero_preflop_action: row.hero_preflop_action,
    hero_net: row.hero_net,
    hero_net_bb: row.hero_net_bb,
    went_to_showdown: row.went_to_showdown,
    hero_net_wsd: row.hero_net_wsd,
    hero_net_wsd_bb: row.hero_net_wsd_bb,
    hero_net_wwsd: row.hero_net_wwsd,
    hero_net_wwsd_bb: row.hero_net_wwsd_bb,
    actions,
  };
}

export type ProfileSyncResult = {
  ok: boolean;
  handsSaved: number;
  duplicatesSkipped: number;
  sessionId: string | null;
  error: string | null;
};

/**
 * After local Analysis: sync IndexedDB hands into the profile HandDatabase.
 * Failures are soft — local HUD/report still work.
 */
export async function syncLocalHandsToProfile(
  strategyId: string,
  opts?: {
    label?: string;
    sourceFilename?: string;
    onProgress?: (p: ProgressPayload) => void;
  },
): Promise<ProfileSyncResult> {
  const onProgress = opts?.onProgress;
  const rows = await listHandsForStrategy(strategyId);
  const payloads = rows.map(rowToPayload).filter((h): h is SyncedHandPayload => h != null);

  if (!payloads.length) {
    return {
      ok: false,
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: "Нет раздач с текстом HH для синхронизации",
    };
  }

  if (payloads.length > MAX_HANDS_PER_ANALYSIS) {
    return {
      ok: false,
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: `За одну сессию можно загрузить не больше ${MAX_HANDS_PER_ANALYSIS.toLocaleString("ru-RU")} рук`,
    };
  }

  try {
    const dbs = await listHandDatabases();
    const active = dbs.find((d) => d.is_active) ?? dbs[0];
    if (active) {
      const limit = active.hands_limit ?? MAX_HANDS_PER_DATABASE;
      const free = Math.max(0, limit - (active.hands_count ?? 0));
      if (payloads.length > free) {
        return {
          ok: false,
          handsSaved: 0,
          duplicatesSkipped: 0,
          sessionId: null,
          error: `В базе «${active.name}» свободно ${free.toLocaleString("ru-RU")} из ${limit.toLocaleString("ru-RU")}, а сессия — ${payloads.length.toLocaleString("ru-RU")} рук`,
        };
      }
    }
  } catch {
    /* server will enforce capacity */
  }

  let sessionId: string | undefined;
  let handsSaved = 0;
  let duplicatesSkipped = 0;
  let last: ClientHandsSyncResponse | null = null;

  const totalChunks = Math.ceil(payloads.length / CHUNK);
  for (let i = 0; i < payloads.length; i += CHUNK) {
    const chunk = payloads.slice(i, i + CHUNK);
    const chunkIdx = Math.floor(i / CHUNK) + 1;
    const finalize = chunkIdx === totalChunks;
    const pct = 92 + Math.round((7 * chunkIdx) / totalChunks);

    onProgress?.({
      done: Math.min(i + chunk.length, payloads.length),
      total: payloads.length,
      phase: "sync",
      message: `Синхронизация в профиль… ${chunkIdx}/${totalChunks}`,
      pct,
    });

    last = await syncClientHands({
      strategy_id: strategyId,
      label: opts?.label,
      source_filename: opts?.sourceFilename ?? "local-import.txt",
      room: "pokerstars",
      hands: chunk,
      session_id: sessionId,
      finalize,
    });
    sessionId = last.session_id;
    handsSaved += last.hands_saved;
    duplicatesSkipped += last.duplicates_skipped;
  }

  onProgress?.({
    done: payloads.length,
    total: payloads.length,
    phase: "sync",
    message: `В профиле: ${handsSaved.toLocaleString("ru-RU")} рук`,
    pct: 99,
  });

  return {
    ok: true,
    handsSaved,
    duplicatesSkipped,
    sessionId: last?.session_id ?? null,
    error: null,
  };
}
