/**
 * Local hand/HUD store via IndexedDB (no sql.js).
 * Each Analysis import replaces hands for that strategy (no double-count).
 */

import type { HudFlags } from "./hudFlags";
import type { ParsedAction, ParsedHand, ParsedSeat } from "./types";

const IDB_NAME = "pokerledger-local-v5";
const STORE_HANDS = "hands";
const STORE_META = "meta";

export type HandRow = {
  key: string;
  external_hand_id: string;
  session_id: string;
  strategy_id: string;
  hero_name: string | null;
  hero_position: string | null;
  hero_hand: string | null;
  hero_hand_code: string | null;
  detected_spot: string | null;
  villain_position: string | null;
  hero_preflop_action: string | null;
  stack_bb: number | null;
  hero_net: number | null;
  hero_net_bb: number | null;
  went_to_showdown: boolean;
  hero_net_wsd: number | null;
  hero_net_wsd_bb: number | null;
  hero_net_wwsd: number | null;
  hero_net_wwsd_bb: number | null;
  table_name: string | null;
  table_max: number | null;
  button_seat: number | null;
  small_blind: number | null;
  big_blind: number | null;
  /** All seated nicknames/stacks for Trainer table. */
  seats: ParsedSeat[];
  /**
   * Preflop actions through hero decision (Trainer / line analysis).
   * Alias domain: also treated as `preflop_actions` for strategy line matching.
   */
  actions: ParsedAction[];
  /** Optional explicit preflop line (same as actions when present). */
  preflop_actions?: ParsedAction[];
  /** Full HH text for local replay */
  raw_text: string;
  vpip: number;
  pfr: number;
  three_bet: number;
  three_bet_opp: number;
  played_at: string | null;
  flags: HudFlags | null;
};

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_HANDS)) {
        db.deleteObjectStore(STORE_HANDS);
      }
      if (db.objectStoreNames.contains(STORE_META)) {
        db.deleteObjectStore(STORE_META);
      }
      const store = db.createObjectStore(STORE_HANDS, { keyPath: "key" });
      store.createIndex("by_strategy", "strategy_id", { unique: false });
      store.createIndex("by_external", "external_hand_id", { unique: false });
      db.createObjectStore(STORE_META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openLocalDb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openIdb();
  return dbPromise;
}

function handKey(strategyId: string, externalId: string) {
  return `${strategyId}::${externalId}`;
}

/**
 * Preflop through hero's last voluntary decision (open + face 3bet, etc.).
 * Needed so strategy compare can score vs_3bet / vs_4bet after hero opened.
 */
function trimTrainerActions(actions: ParsedAction[]): ParsedAction[] {
  const preflop: ParsedAction[] = [];
  let lastHeroIdx = -1;
  for (const a of actions) {
    if ((a.street || "").toLowerCase() !== "preflop") break;
    preflop.push(a);
    if (a.is_hero && ["raise", "call", "fold"].includes((a.action || "").toLowerCase())) {
      lastHeroIdx = preflop.length - 1;
    }
  }
  if (lastHeroIdx < 0) return preflop;
  return preflop.slice(0, lastHeroIdx + 1);
}

function toRow(strategyId: string, sessionId: string, h: ParsedHand): HandRow {
  return {
    key: handKey(strategyId, h.external_hand_id),
    external_hand_id: h.external_hand_id,
    session_id: sessionId,
    strategy_id: strategyId,
    hero_name: h.hero_name,
    hero_position: h.hero_position,
    hero_hand: h.hero_hand,
    hero_hand_code: h.hero_hand_code,
    detected_spot: h.detected_spot,
    villain_position: h.villain_position,
    hero_preflop_action: h.hero_preflop_action,
    stack_bb: h.stack_bb,
    hero_net: h.hero_net,
    hero_net_bb: h.hero_net_bb,
    went_to_showdown: h.went_to_showdown,
    hero_net_wsd: h.hero_net_wsd,
    hero_net_wsd_bb: h.hero_net_wsd_bb,
    hero_net_wwsd: h.hero_net_wwsd,
    hero_net_wwsd_bb: h.hero_net_wwsd_bb,
    table_name: h.table_name,
    table_max: h.table_max ?? null,
    button_seat: h.button_seat ?? null,
    small_blind: h.small_blind,
    big_blind: h.big_blind,
    seats: Array.isArray(h.seats) ? h.seats : [],
    actions: trimTrainerActions(h.actions),
    preflop_actions: trimTrainerActions(h.actions),
    raw_text: h.raw_text,
    vpip: h.vpip ? 1 : 0,
    pfr: h.pfr ? 1 : 0,
    three_bet: h.three_bet ? 1 : 0,
    three_bet_opp: h.three_bet_opp ? 1 : 0,
    played_at: h.played_at,
    flags: h.flags ?? null,
  };
}

/** Wipe all local hands for a strategy before a fresh Analysis import. */
export async function clearStrategyHands(strategyId: string): Promise<number> {
  const db = await openLocalDb();
  const rows = await listHandsForStrategy(strategyId);
  if (!rows.length) return 0;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_HANDS], "readwrite");
    const store = tx.objectStore(STORE_HANDS);
    for (const r of rows) store.delete(r.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
  });
  return rows.length;
}

export async function insertHandBatch(
  strategyId: string,
  sessionId: string,
  hands: ParsedHand[],
): Promise<{ inserted: number; duplicates: number }> {
  const db = await openLocalDb();
  let inserted = 0;
  let duplicates = 0;

  for (const h of hands) {
    const row = toRow(strategyId, sessionId, h);
    // eslint-disable-next-line no-await-in-loop
    const existed = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction([STORE_HANDS], "readwrite");
      const store = tx.objectStore(STORE_HANDS);
      const getReq = store.get(row.key);
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve(true);
          return;
        }
        store.put(row);
        resolve(false);
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("get failed"));
      tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    });
    if (existed) duplicates += 1;
    else inserted += 1;
  }

  return { inserted, duplicates };
}

export async function countHandsForStrategy(strategyId: string): Promise<number> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDS, "readonly");
    const req = tx.objectStore(STORE_HANDS).index("by_strategy").count(strategyId);
    req.onsuccess = () => resolve(Number(req.result) || 0);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB count failed"));
  });
}

export async function listHandsForStrategy(strategyId: string): Promise<HandRow[]> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_HANDS], "readonly");
    const idx = tx.objectStore(STORE_HANDS).index("by_strategy");
    const req = idx.getAll(strategyId);
    req.onsuccess = () => resolve((req.result as HandRow[]) || []);
    req.onerror = () => reject(req.error ?? new Error("list hands failed"));
  });
}

export async function flushLocalDb(): Promise<void> {
  /* no-op */
}
