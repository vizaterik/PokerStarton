import type { HandDatabase } from "../api/client";

export type HandDbMeta = {
  id: string;
  name: string;
  handsCount: number;
  sessionsCount: number;
  updatedAt: number;
};

const KEY = "pokerledger.handdb.v1";
const LAST_STRATEGY_KEY = "pokerledger.lastStrategyId";

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  }
}

/** Stable token for cache fingerprints — id only (hands count must not bust cache). */
export function handDbToken(meta: HandDbMeta | null | undefined): string {
  return meta?.id ? meta.id : "none";
}

export function readHandDbMeta(): HandDbMeta | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HandDbMeta;
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeHandDbMeta(meta: HandDbMeta) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ ...meta, updatedAt: Date.now() }));
  } catch {
    /* ignore quota */
  }
}

export function clearHandDbMeta() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function metaFromDatabase(db: HandDatabase): HandDbMeta {
  return {
    id: db.id,
    name: db.name,
    handsCount: db.hands_count ?? 0,
    sessionsCount: db.sessions_count ?? 0,
    updatedAt: Date.now(),
  };
}

/** Optimistic bump after upload so UI counters stay warm before /databases refetch. */
export function bumpHandDbMetaAfterUpload(addedHands: number) {
  const prev = readHandDbMeta();
  if (!prev) return;
  const add = Math.max(0, Math.floor(addedHands));
  writeHandDbMeta({
    ...prev,
    handsCount: prev.handsCount + add,
    sessionsCount: prev.sessionsCount + 1,
    updatedAt: Date.now(),
  });
}

export function readLastStrategyId(): string | null {
  try {
    return storage()?.getItem(LAST_STRATEGY_KEY) || null;
  } catch {
    return null;
  }
}

export function writeLastStrategyId(id: string) {
  if (!id) return;
  try {
    storage()?.setItem(LAST_STRATEGY_KEY, id);
  } catch {
    /* ignore */
  }
}
