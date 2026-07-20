import type {
  EnsuredSpotInfo,
  PlaySession,
  StrategyAnalysis,
  StrategyDeviationsResponse,
  StrategySpot,
} from "../api/client";
import { handDbToken, readHandDbMeta } from "./handDbCache";

export type AnalysisCachePayload = {
  fingerprint: string;
  analysis: StrategyAnalysis;
  deviations: StrategyDeviationsResponse;
  spots: StrategySpot[];
  missing: EnsuredSpotInfo[];
  handTotal: number;
  savedAt: number;
  /** Local charts fingerprint at the time the report was built. */
  chartsRev?: string | null;
  /** Strategy.updated_at when the report was built. */
  strategyUpdatedAt?: string | null;
  /** Bump when strategy-compare grouping rules change (forces rebuild). */
  chartCompareVer?: number;
};

/** Current strategy-compare cache schema (strict pot+matchup attribution). */
export const CHART_COMPARE_VER = 11;

/** v7: sync tree by painted jobs; score synced spots (exact matchup). */
const PREFIX = "pokerledger.analysis.v7:";
/** Slim HUD/curve only — Analysis nav open must not JSON.parse thousands of errors. */
const HUD_PREFIX = "pokerledger.analysis.hud.v1:";
const LEGACY = [
  "pokerledger.analysis.v1:",
  "pokerledger.analysis.v2:",
  "pokerledger.analysis.v3:",
  "pokerledger.analysis.v4:",
  "pokerledger.analysis.v5:",
  "pokerledger.analysis.v6:",
];

export type AnalysisHudCache = {
  fingerprint: string;
  analysis: StrategyAnalysis;
  handTotal: number;
  savedAt: number;
  chartsRev?: string | null;
  strategyUpdatedAt?: string | null;
};

const memory = new Map<string, AnalysisCachePayload>();
const hudMemory = new Map<string, AnalysisHudCache>();

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

/** Stable fingerprint of active hands/sessions for a strategy. */
export function analysisFingerprint(strategyId: string, sessions: PlaySession[]): string {
  const parts = sessions
    .filter(
      (s) =>
        s.strategy_id === strategyId && (s.status === "active" || !s.status),
    )
    .map((s) => `${s.id}:${s.hands_count}:${s.status ?? "active"}`)
    .sort();
  const hands = parts.reduce((sum, p) => {
    const n = Number(p.split(":")[1] || 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  // DB id only — hands/sessions already in `parts`; changing hand counts must not bust a valid cache.
  const db = handDbToken(readHandDbMeta());
  return `${strategyId}|db:${db}|h:${hands}|${parts.join(",")}`;
}

function fromStorage(strategyId: string): AnalysisCachePayload | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + strategyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisCachePayload;
    if (!parsed?.analysis || !parsed?.deviations || !parsed?.fingerprint) return null;
    memory.set(strategyId, parsed);
    // Migrate: next Analysis open reads slim HUD key only.
    writeHudSlim(strategyId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function hudFromStorage(strategyId: string): AnalysisHudCache | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(HUD_PREFIX + strategyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisHudCache;
    if (!parsed?.analysis || !parsed?.fingerprint) return null;
    hudMemory.set(strategyId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Any cached payload for strategy (may be stale — check fingerprint). */
export function peekAnalysisCache(strategyId: string): AnalysisCachePayload | null {
  return memory.get(strategyId) ?? fromStorage(strategyId);
}

/**
 * HUD/curve only — safe for Analysis page first paint.
 * Avoids parsing the full deviations blob from localStorage.
 */
export function peekAnalysisHud(strategyId: string): AnalysisHudCache | null {
  const mem = hudMemory.get(strategyId);
  if (mem) return mem;
  const full = memory.get(strategyId);
  if (full) {
    const slim: AnalysisHudCache = {
      fingerprint: full.fingerprint,
      analysis: full.analysis,
      handTotal: full.handTotal,
      savedAt: full.savedAt,
      chartsRev: full.chartsRev,
      strategyUpdatedAt: full.strategyUpdatedAt,
    };
    hudMemory.set(strategyId, slim);
    return slim;
  }
  // Prefer slim key only — never JSON.parse the full deviations blob on nav open.
  return hudFromStorage(strategyId);
}

/** Only return cache when fingerprint still matches current hands. */
export function readAnalysisCache(
  strategyId: string,
  fingerprint: string,
): AnalysisCachePayload | null {
  const parsed = peekAnalysisCache(strategyId);
  if (!parsed || parsed.fingerprint !== fingerprint) return null;
  return parsed;
}

function writeHudSlim(strategyId: string, full: AnalysisCachePayload) {
  const slim: AnalysisHudCache = {
    fingerprint: full.fingerprint,
    analysis: full.analysis,
    handTotal: full.handTotal,
    savedAt: full.savedAt,
    chartsRev: full.chartsRev,
    strategyUpdatedAt: full.strategyUpdatedAt,
  };
  hudMemory.set(strategyId, slim);
  const store = storage();
  if (!store) return;
  try {
    store.setItem(HUD_PREFIX + strategyId, JSON.stringify(slim));
  } catch {
    /* ignore — full cache still in memory */
  }
}

export function writeAnalysisCache(
  strategyId: string,
  payload: Omit<AnalysisCachePayload, "savedAt">,
) {
  const full: AnalysisCachePayload = { ...payload, savedAt: Date.now() };
  memory.set(strategyId, full);
  writeHudSlim(strategyId, full);
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PREFIX + strategyId, JSON.stringify(full));
  } catch {
    /* quota — drop oldest analysis keys and retry once */
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (k?.startsWith(PREFIX) || k?.startsWith(HUD_PREFIX)) keys.push(k);
      }
      keys.sort();
      for (const k of keys.slice(0, Math.max(1, Math.floor(keys.length / 2)))) {
        store.removeItem(k);
      }
      store.setItem(PREFIX + strategyId, JSON.stringify(full));
      writeHudSlim(strategyId, full);
    } catch {
      /* memory still works */
    }
  }
}

export function clearAnalysisCache(strategyId?: string) {
  try {
    if (strategyId) {
      memory.delete(strategyId);
      hudMemory.delete(strategyId);
      storage()?.removeItem(PREFIX + strategyId);
      storage()?.removeItem(HUD_PREFIX + strategyId);
      return;
    }
    memory.clear();
    hudMemory.clear();
    const store = storage();
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (
        k &&
        (k.startsWith(PREFIX) ||
          k.startsWith(HUD_PREFIX) ||
          LEGACY.some((p) => k.startsWith(p)))
      ) {
        keys.push(k);
      }
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * Charts changed in the constructor — keep HUD/session, invalidate compare stamp.
 * Important: do NOT write the new chartsRev onto the cache (that made stale
 * deviations look fresh). Storage already has the new rev via setChartsRevision;
 * clearing the cache stamp forces «Стратегии» to rebuild.
 */
export function markAnalysisChartsStale(strategyId: string, _chartsRev: string) {
  const cached = peekAnalysisCache(strategyId);
  if (!cached) return;
  if (cached.chartsRev == null) return;
  writeAnalysisCache(strategyId, {
    ...cached,
    chartsRev: null,
    strategyUpdatedAt: cached.strategyUpdatedAt ?? null,
  });
}
