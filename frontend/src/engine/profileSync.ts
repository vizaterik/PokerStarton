/**
 * Keep the profile hand DB in sync with local IndexedDB.
 * Analysis still runs in the browser for speed; this copies hands to the server.
 */

import { isLoggedIn } from "../api/client";
import { peekAnalysisCache } from "../lib/analysisCache";
import { countHandsForStrategy, listHandsForStrategy } from "./localDb";
import { finalizeLocalAnalysis } from "./localAnalysis";
import {
  uploadLocalAnalysisSnapshot,
  type SnapshotUploadResult,
} from "./uploadAnalysisSnapshot";

const SYNC_KEY = "ps_profile_sync_v1:";

export type ProfileSyncState = {
  strategyId: string;
  /** Fingerprint of local hands that were last successfully pushed. */
  fingerprint: string;
  handCount: number;
  syncedAt: number;
  error: string | null;
  /** Last known server session hands_total from snapshot response. */
  serverHandsTotal: number | null;
};

function storageKey(strategyId: string) {
  return SYNC_KEY + strategyId;
}

export function readProfileSyncState(strategyId: string): ProfileSyncState | null {
  try {
    const raw = localStorage.getItem(storageKey(strategyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileSyncState;
    if (!parsed?.strategyId || parsed.strategyId !== strategyId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeProfileSyncState(state: ProfileSyncState) {
  try {
    localStorage.setItem(storageKey(state.strategyId), JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function markProfileSyncError(strategyId: string, error: string) {
  const prev = readProfileSyncState(strategyId);
  writeProfileSyncState({
    strategyId,
    fingerprint: prev?.fingerprint ?? "",
    handCount: prev?.handCount ?? 0,
    syncedAt: prev?.syncedAt ?? 0,
    error,
    serverHandsTotal: prev?.serverHandsTotal ?? null,
  });
}

/** Cheap identity of the local stack — changes when hands are added/removed. */
export async function localHandsFingerprint(strategyId: string): Promise<{
  fingerprint: string;
  handCount: number;
}> {
  const rows = await listHandsForStrategy(strategyId);
  const handCount = rows.length;
  if (!handCount) return { fingerprint: "empty", handCount: 0 };
  let minId = rows[0].external_hand_id;
  let maxId = rows[0].external_hand_id;
  let minAt = rows[0].played_at || "";
  let maxAt = rows[0].played_at || "";
  for (const r of rows) {
    if (r.external_hand_id < minId) minId = r.external_hand_id;
    if (r.external_hand_id > maxId) maxId = r.external_hand_id;
    const at = r.played_at || "";
    if (at && (!minAt || at < minAt)) minAt = at;
    if (at && (!maxAt || at > maxAt)) maxAt = at;
  }
  return {
    fingerprint: `${handCount}:${minId}:${maxId}:${minAt}:${maxAt}`,
    handCount,
  };
}

export function isProfileSyncCurrent(
  strategyId: string,
  fingerprint: string,
): boolean {
  const st = readProfileSyncState(strategyId);
  return Boolean(st && !st.error && st.fingerprint === fingerprint && fingerprint !== "empty");
}

export type EnsureSyncResult = SnapshotUploadResult & {
  skipped: boolean;
  reason?: string;
};

/**
 * Push local hands + analysis report into the active profile hand DB.
 * No-op when already synced for the current local fingerprint.
 */
export async function ensureHandsSyncedToServer(
  strategyId: string,
  opts?: {
    force?: boolean;
    label?: string;
    sourceFilename?: string;
    onProgress?: (message: string, pct: number) => void;
  },
): Promise<EnsureSyncResult> {
  if (!strategyId) {
    return {
      ok: false,
      skipped: true,
      reason: "no-strategy",
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: "Нет стратегии",
      response: null,
    };
  }

  if (!isLoggedIn()) {
    markProfileSyncError(strategyId, "Войдите в аккаунт, чтобы сохранить раздачи на сервер");
    return {
      ok: false,
      skipped: true,
      reason: "not-logged-in",
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: "Войдите в аккаунт, чтобы сохранить раздачи на сервер",
      response: null,
    };
  }

  const { fingerprint, handCount } = await localHandsFingerprint(strategyId);
  if (handCount === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "empty",
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: null,
      response: null,
    };
  }

  if (!opts?.force && isProfileSyncCurrent(strategyId, fingerprint)) {
    return {
      ok: true,
      skipped: true,
      reason: "already-synced",
      handsSaved: 0,
      duplicatesSkipped: handCount,
      sessionId: null,
      error: null,
      response: null,
    };
  }

  // Snapshot upload needs a ready analysis cache.
  if (!peekAnalysisCache(strategyId)?.analysis) {
    opts?.onProgress?.("Собираем отчёт перед синхронизацией…", 20);
    await finalizeLocalAnalysis(strategyId, (p) => {
      opts?.onProgress?.(p.message, Math.min(55, Math.max(10, p.pct)));
    });
  }

  const snap = await uploadLocalAnalysisSnapshot(strategyId, {
    label: opts?.label ?? "Синхронизация базы",
    sourceFilename: opts?.sourceFilename ?? "profile-sync.txt",
    onProgress: opts?.onProgress,
  });

  if (snap.ok) {
    writeProfileSyncState({
      strategyId,
      fingerprint,
      handCount,
      syncedAt: Date.now(),
      error: null,
      serverHandsTotal: snap.response?.hands_total ?? null,
    });
    return { ...snap, skipped: false };
  }

  // Benign: missing/stale strategy must not block hand DB sync (server accepts null).
  const soft =
    !snap.error ||
    /не найден|not found/i.test(snap.error);
  if (soft) {
    writeProfileSyncState({
      strategyId,
      fingerprint,
      handCount,
      syncedAt: Date.now(),
      error: null,
      serverHandsTotal: null,
    });
    return {
      ...snap,
      ok: true,
      skipped: false,
      error: null,
      reason: "soft-ok",
    };
  }

  markProfileSyncError(
    strategyId,
    snap.error || "Не удалось сохранить раздачи на сервер",
  );
  return { ...snap, skipped: false };
}

/** Background reconcile used on Analysis page open. */
export async function reconcileProfileSync(
  strategyId: string,
): Promise<EnsureSyncResult> {
  const n = await countHandsForStrategy(strategyId);
  if (n < 1) {
    return {
      ok: true,
      skipped: true,
      reason: "empty",
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: null,
      response: null,
    };
  }
  return ensureHandsSyncedToServer(strategyId, {
    label: "Автосинхронизация",
    sourceFilename: "auto-sync.txt",
  });
}
