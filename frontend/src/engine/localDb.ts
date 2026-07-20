/**
 * Local hand/HUD store via IndexedDB (no sql.js).
 * Stacked imports append; duplicates skipped by normalized external_hand_id + content fingerprint.
 */

import type { HudFlags } from "./hudFlags";
import { normalizeExternalHandId } from "./parseHh";
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

/** Soft identity when hand ids diverge across exports of the same HH. */
function contentFingerprint(
  h: Pick<
    HandRow | ParsedHand,
    "played_at" | "hero_hand_code" | "hero_net" | "table_name" | "hero_position" | "hero_name"
  >,
): string {
  const net =
    h.hero_net == null || !Number.isFinite(h.hero_net)
      ? ""
      : String(Math.round(h.hero_net * 100) / 100);
  return [
    h.played_at || "",
    h.hero_hand_code || "",
    net,
    h.table_name || "",
    h.hero_position || "",
    h.hero_name || "",
  ].join("|");
}

function preferHandRow(a: HandRow, b: HandRow): HandRow {
  const al = a.raw_text?.length || 0;
  const bl = b.raw_text?.length || 0;
  if (al !== bl) return al > bl ? a : b;
  return a.key <= b.key ? a : b;
}

function hasStrongFingerprint(
  h: Pick<HandRow | ParsedHand, "played_at" | "hero_hand_code" | "hero_net">,
): boolean {
  return Boolean(h.played_at) && (Boolean(h.hero_hand_code) || h.hero_net != null);
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
  const externalId = normalizeExternalHandId(h.external_hand_id);
  return {
    key: handKey(strategyId, externalId),
    external_hand_id: externalId,
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

/** Max new+existing hands per calendar day in the stacked local DB. */
export const DAILY_HAND_UPLOAD_LIMIT = 5000;

/** Calendar day key from hand timestamp (`YYYY-MM-DD` or `unknown`). */
export function handCalendarDay(playedAt: string | null | undefined): string {
  if (!playedAt) return "unknown";
  const iso = playedAt.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(playedAt);
  if (!Number.isFinite(t)) return "unknown";
  return new Date(t).toISOString().slice(0, 10);
}

export type SessionDayRow = { day: string; hands: number };

/** Distinct session days in the stacked DB (newest first). */
export async function listSessionDays(strategyId: string): Promise<SessionDayRow[]> {
  const rows = await listHandsForStrategy(strategyId);
  const map = new Map<string, number>();
  for (const r of rows) {
    const day = handCalendarDay(r.played_at);
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([day, hands]) => ({ day, hands }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export type ListHandsOpts = {
  /** If set, only hands on these calendar days. Empty array → no hands. */
  days?: string[] | null;
};

/** Explicit wipe of local hands for a strategy (not used on normal session import). */
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

export async function loadDayHandCounts(
  strategyId: string,
): Promise<Map<string, number>> {
  const existing = await listHandsForStrategy(strategyId);
  const dayCounts = new Map<string, number>();
  for (const r of existing) {
    const day = handCalendarDay(r.played_at);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  return dayCounts;
}

export async function insertHandBatch(
  strategyId: string,
  sessionId: string,
  hands: ParsedHand[],
  dayCounts?: Map<string, number>,
  /** Cross-chunk seen keys / content fingerprints for one import run. */
  seenInImport?: Set<string>,
): Promise<{ inserted: number; duplicates: number; limitSkipped: number }> {
  const db = await openLocalDb();
  let inserted = 0;
  let duplicates = 0;
  let limitSkipped = 0;

  // Reuse caller's map across chunks so we don't re-scan the whole DB each batch.
  const counts = dayCounts ?? (await loadDayHandCounts(strategyId));
  const seen = seenInImport ?? new Set<string>();

  for (const h of hands) {
    const row = toRow(strategyId, sessionId, h);
    if (!row.external_hand_id) {
      duplicates += 1;
      continue;
    }
    const strongFp = hasStrongFingerprint(row);
    const fp = strongFp ? contentFingerprint(row) : "";
    const fpKey = fp ? `fp:${fp}` : "";
    if (seen.has(row.key) || (fpKey && seen.has(fpKey))) {
      duplicates += 1;
      continue;
    }
    const day = handCalendarDay(h.played_at);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await new Promise<"dup" | "ins" | "limit">((resolve, reject) => {
      const tx = db.transaction([STORE_HANDS], "readwrite");
      const store = tx.objectStore(STORE_HANDS);
      const getReq = store.get(row.key);
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve("dup");
          return;
        }
        const have = counts.get(day) ?? 0;
        if (have >= DAILY_HAND_UPLOAD_LIMIT) {
          resolve("limit");
          return;
        }
        store.put(row);
        counts.set(day, have + 1);
        resolve("ins");
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("get failed"));
      tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    });
    if (outcome === "dup") {
      duplicates += 1;
      seen.add(row.key);
      if (fpKey) seen.add(fpKey);
    } else if (outcome === "limit") {
      limitSkipped += 1;
    } else {
      inserted += 1;
      seen.add(row.key);
      if (fpKey) seen.add(fpKey);
    }
  }

  return { inserted, duplicates, limitSkipped };
}

/**
 * Remove duplicate hands already stored (normalized id + content fingerprint).
 * Also migrates keys when external ids still contain commas/spaces.
 * Returns number of rows deleted.
 */
export async function dedupeStrategyHands(strategyId: string): Promise<number> {
  const rows = await listHandsForStrategy(strategyId);
  if (rows.length < 2) {
    // Still migrate a single mis-keyed row if needed.
    if (rows.length === 1) {
      const r = rows[0];
      const nid = normalizeExternalHandId(r.external_hand_id);
      const want = handKey(strategyId, nid);
      if (nid && (r.key !== want || r.external_hand_id !== nid)) {
        const db = await openLocalDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORE_HANDS], "readwrite");
          const store = tx.objectStore(STORE_HANDS);
          store.delete(r.key);
          store.put({ ...r, key: want, external_hand_id: nid });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("migrate failed"));
        });
      }
    }
    return 0;
  }

  const byId = new Map<string, HandRow>();
  const orphans: HandRow[] = [];
  for (const r of rows) {
    const nid = normalizeExternalHandId(r.external_hand_id);
    if (!nid) {
      orphans.push(r);
      continue;
    }
    const prev = byId.get(nid);
    if (!prev) byId.set(nid, { ...r, external_hand_id: nid });
    else byId.set(nid, preferHandRow({ ...prev, external_hand_id: nid }, { ...r, external_hand_id: nid }));
  }

  const byFp = new Map<string, HandRow>();
  for (const r of byId.values()) {
    if (!hasStrongFingerprint(r)) {
      byFp.set(`id:${r.external_hand_id}`, r);
      continue;
    }
    const fp = contentFingerprint(r);
    const prev = byFp.get(fp);
    if (!prev) byFp.set(fp, r);
    else byFp.set(fp, preferHandRow(prev, r));
  }
  for (const r of orphans) {
    if (!hasStrongFingerprint(r)) continue;
    const fp = contentFingerprint(r);
    const prev = byFp.get(fp);
    if (!prev) byFp.set(fp, r);
    else byFp.set(fp, preferHandRow(prev, r));
  }

  const keep = new Map<string, HandRow>();
  for (const r of byFp.values()) {
    const nid = normalizeExternalHandId(r.external_hand_id);
    const next: HandRow = {
      ...r,
      external_hand_id: nid || r.external_hand_id,
      key: handKey(strategyId, nid || r.external_hand_id),
    };
    keep.set(next.key, next);
  }

  const toDelete: string[] = [];
  for (const r of rows) {
    if (!keep.has(r.key)) toDelete.push(r.key);
  }
  // Rewrites: same logical hand, wrong key/id formatting.
  const toPut: HandRow[] = [];
  for (const next of keep.values()) {
    const old = rows.find((r) => r.key === next.key);
    if (!old || old.external_hand_id !== next.external_hand_id) {
      toPut.push(next);
      // If we kept a row under a new key, ensure the old unnormalized key is deleted.
      for (const r of rows) {
        if (
          r.key !== next.key &&
          normalizeExternalHandId(r.external_hand_id) === next.external_hand_id
        ) {
          if (!toDelete.includes(r.key)) toDelete.push(r.key);
        }
      }
    }
  }

  if (!toDelete.length && !toPut.length) return 0;

  const db = await openLocalDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_HANDS], "readwrite");
    const store = tx.objectStore(STORE_HANDS);
    for (const key of toDelete) store.delete(key);
    for (const row of toPut) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("dedupe failed"));
  });
  return toDelete.length;
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

export async function listHandsForStrategy(
  strategyId: string,
  opts?: ListHandsOpts,
): Promise<HandRow[]> {
  const db = await openLocalDb();
  const rows = await new Promise<HandRow[]>((resolve, reject) => {
    const tx = db.transaction([STORE_HANDS], "readonly");
    const idx = tx.objectStore(STORE_HANDS).index("by_strategy");
    const req = idx.getAll(strategyId);
    req.onsuccess = () => resolve((req.result as HandRow[]) || []);
    req.onerror = () => reject(req.error ?? new Error("list hands failed"));
  });
  if (!opts?.days) return rows;
  if (opts.days.length === 0) return [];
  const want = new Set(opts.days);
  return rows.filter((r) => want.has(handCalendarDay(r.played_at)));
}

export async function flushLocalDb(): Promise<void> {
  /* no-op */
}
