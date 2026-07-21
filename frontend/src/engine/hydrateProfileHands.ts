/**
 * Pull all hands from the active profile hand DB into local IndexedDB
 * so Analysis can rebuild the report offline-fast.
 */

import {
  fetchActiveDatabaseHands,
  isLoggedIn,
  listHandDatabases,
  type ExportedProfileHand,
} from "../api/client";
import {
  countHandsForAnalysis,
  insertHandBatch,
  loadDayHandCounts,
} from "./localDb";
import type { ParsedHand } from "./types";

function toParsed(h: ExportedProfileHand): ParsedHand {
  return {
    external_hand_id: h.external_hand_id,
    raw_text: h.raw_text || `Hand #${h.external_hand_id}`,
    played_at: h.played_at,
    table_name: h.table_name,
    table_max: null,
    button_seat: null,
    small_blind: h.small_blind,
    big_blind: h.big_blind,
    hero_name: h.hero_name,
    hero_position: h.hero_position,
    hero_hand: h.hero_hand,
    hero_hand_code: h.hero_hand_code,
    detected_spot: h.detected_spot,
    villain_position: h.villain_position,
    stack_bb: h.stack_bb,
    hero_preflop_action: h.hero_preflop_action,
    hero_net: h.hero_net,
    hero_net_bb: h.hero_net_bb,
    went_to_showdown: Boolean(h.went_to_showdown),
    hero_net_wsd: h.hero_net_wsd,
    hero_net_wsd_bb: h.hero_net_wsd_bb,
    hero_net_wwsd: h.hero_net_wwsd,
    hero_net_wwsd_bb: h.hero_net_wwsd_bb,
    seats: [],
    actions: (h.actions || []).map((a) => ({
      street: a.street,
      action_order: a.action_order,
      player_name: a.player_name,
      is_hero: a.is_hero,
      action: a.action,
      amount: a.amount,
    })),
    vpip: false,
    pfr: false,
    three_bet: false,
    three_bet_opp: false,
  };
}

export type HydrateResult = {
  serverTotal: number;
  localBefore: number;
  localAfter: number;
  inserted: number;
  skipped: boolean;
};

/**
 * If the profile DB has more hands than local Analysis storage, download them.
 */
export async function hydrateAnalysisHandsFromProfile(
  strategyId: string,
  opts?: { onProgress?: (message: string) => void },
): Promise<HydrateResult> {
  const empty: HydrateResult = {
    serverTotal: 0,
    localBefore: 0,
    localAfter: 0,
    inserted: 0,
    skipped: true,
  };
  if (!strategyId || !isLoggedIn()) return empty;

  const localBefore = await countHandsForAnalysis(strategyId);
  let serverTotal = 0;
  try {
    const dbs = await listHandDatabases();
    const active = dbs.find((d) => d.is_active) ?? dbs[0];
    serverTotal = active?.hands_count ?? 0;
  } catch {
    return { ...empty, localBefore, localAfter: localBefore };
  }

  if (serverTotal < 1 || localBefore >= serverTotal) {
    return {
      serverTotal,
      localBefore,
      localAfter: localBefore,
      inserted: 0,
      skipped: true,
    };
  }

  opts?.onProgress?.(
    `Загружаем базу профиля… ${localBefore.toLocaleString("ru-RU")} / ${serverTotal.toLocaleString("ru-RU")}`,
  );

  const sessionId = `hydrate-${Date.now().toString(36)}`;
  const dayCounts = await loadDayHandCounts(strategyId);
  const seen = new Set<string>();
  let inserted = 0;
  let offset = 0;
  const pageSize = 400;

  while (offset < serverTotal) {
    const page = await fetchActiveDatabaseHands(offset, pageSize);
    if (!page.hands.length) break;
    serverTotal = Math.max(serverTotal, page.total);
    const parsed = page.hands.map(toParsed);
    const res = await insertHandBatch(
      strategyId,
      sessionId,
      parsed,
      dayCounts,
      seen,
    );
    inserted += res.inserted;
    offset += page.hands.length;
    opts?.onProgress?.(
      `Загружаем базу профиля… ${Math.min(offset, serverTotal).toLocaleString("ru-RU")} / ${serverTotal.toLocaleString("ru-RU")}`,
    );
    if (page.hands.length < pageSize) break;
  }

  const localAfter = await countHandsForAnalysis(strategyId);
  return {
    serverTotal,
    localBefore,
    localAfter,
    inserted,
    skipped: false,
  };
}
