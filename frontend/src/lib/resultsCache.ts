import type { ResultsReport } from "../api/client";
import { handDbToken, readHandDbMeta } from "./handDbCache";

export type ResultsCachePayload = {
  fingerprint: string;
  report: ResultsReport;
  savedAt: number;
};

/** v7: unique hands in active hand-DB (re-upload dupes purged server-side). */
const PREFIX = "pokerledger.results.v7:";
const LEGACY = [
  "pokerledger.results.v1:",
  "pokerledger.results.v2:",
  "pokerledger.results.v3:",
  "pokerledger.results.v4:",
  "pokerledger.results.v5:",
  "pokerledger.results.v6:",
];

const memory = new Map<string, ResultsCachePayload>();

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

export function resultsFingerprint(
  sessionId: string,
  dateFrom?: string,
  dateTo?: string,
  dbToken?: string,
): string {
  const db = dbToken ?? handDbToken(readHandDbMeta());
  return `db:${db}|s:${sessionId || "all"}|from:${dateFrom ?? ""}|to:${dateTo ?? ""}`;
}

function storageKey(fp: string) {
  return PREFIX + fp;
}

export function readResultsCache(fingerprint: string): ResultsReport | null {
  const mem = memory.get(fingerprint);
  if (mem?.report) return mem.report;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey(fingerprint));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResultsCachePayload;
    if (!parsed?.report || parsed.fingerprint !== fingerprint) return null;
    memory.set(fingerprint, parsed);
    return parsed.report;
  } catch {
    return null;
  }
}

/** Best effort: any all-time report for current (or last) DB — for schedule instant paint. */
export function peekLatestResultsCache(): ResultsReport | null {
  const fp = resultsFingerprint("");
  const hit = readResultsCache(fp);
  if (hit) return hit;
  // Fall back to newest memory entry
  let best: ResultsCachePayload | null = null;
  for (const v of memory.values()) {
    if (!best || v.savedAt > best.savedAt) best = v;
  }
  if (best?.report) return best.report;
  const store = storage();
  if (!store) return null;
  try {
    let newest: ResultsCachePayload | null = null;
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const raw = store.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as ResultsCachePayload;
      if (!parsed?.report) continue;
      if (!newest || parsed.savedAt > newest.savedAt) newest = parsed;
    }
    if (newest) {
      memory.set(newest.fingerprint, newest);
      return newest.report;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeResultsCache(fingerprint: string, report: ResultsReport) {
  const full: ResultsCachePayload = {
    fingerprint,
    report,
    savedAt: Date.now(),
  };
  memory.set(fingerprint, full);
  const store = storage();
  if (!store) return;
  try {
    store.setItem(storageKey(fingerprint), JSON.stringify(full));
  } catch {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (k?.startsWith(PREFIX)) keys.push(k);
      }
      for (const k of keys.slice(0, Math.max(1, Math.floor(keys.length / 2)))) {
        store.removeItem(k);
      }
      store.setItem(storageKey(fingerprint), JSON.stringify(full));
    } catch {
      /* memory still works */
    }
  }
}

export function clearResultsCache() {
  memory.clear();
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && (k.startsWith(PREFIX) || LEGACY.some((p) => k.startsWith(p)))) {
        keys.push(k);
      }
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    /* ignore */
  }
}
