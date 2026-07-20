import { createDocument } from "./engine";
import { compactDocumentTree } from "./rangesSparse";
import { seatsFor } from "./seats";
import { idbGetTree, idbPutTree } from "./treeIdb";
import type { GameTreeDocument, GameTreeNode, Seat } from "./types";

const KEY = (strategyId: string) => `pokerledger.gameTree.v1.${strategyId}`;

/** In-memory cache — avoid re-parsing localStorage on every loadTree call. */
const memory = new Map<string, GameTreeDocument>();

const saveTimers = new Map<string, number>();
const SAVE_DEBOUNCE_MS = 400;

function migrateSeats(node: GameTreeNode): void {
  if (node.activePlayer === ("MP" as Seat)) node.activePlayer = "HJ";
  for (const child of node.children) migrateSeats(child);
}

export function normalizeTree(
  raw: unknown,
  strategyId: string,
): GameTreeDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as GameTreeDocument;
  if (parsed.version !== 1 || !parsed.root) return null;
  const id = String(parsed.strategyId || strategyId);
  if (id !== strategyId) return null;
  const doc: GameTreeDocument = {
    ...parsed,
    strategyId,
  };
  if (doc.tableSize === 6) migrateSeats(doc.root);
  // Preflop always starts at the first seat (UTG / BTN…). Wrong root seat
  // breaks open-raise seeding (can't skip-ahead backwards).
  const first = seatsFor(doc.tableSize)[0];
  if (doc.root.activePlayer !== first) {
    doc.root.activePlayer = first;
  }
  return doc;
}

function cloneForStorage(doc: GameTreeDocument): GameTreeDocument {
  const copy = structuredClone(doc) as GameTreeDocument;
  compactDocumentTree(copy.root);
  return copy;
}

function writeLocalStorage(doc: GameTreeDocument): boolean {
  try {
    const slim = cloneForStorage(doc);
    localStorage.setItem(KEY(slim.strategyId), JSON.stringify(slim));
    return true;
  } catch {
    return false;
  }
}

/** Sync read — memory first, then localStorage. Does not hit IndexedDB. */
export function loadTree(strategyId: string): GameTreeDocument {
  const cached = memory.get(strategyId);
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY(strategyId));
    if (!raw) {
      const fresh = createDocument(strategyId);
      memory.set(strategyId, fresh);
      return fresh;
    }
    const doc = normalizeTree(JSON.parse(raw), strategyId);
    const next = doc ?? createDocument(strategyId);
    // Migrate legacy dense fold shells → sparse in memory.
    compactDocumentTree(next.root);
    memory.set(strategyId, next);
    return next;
  } catch {
    const fresh = createDocument(strategyId);
    memory.set(strategyId, fresh);
    return fresh;
  }
}

/**
 * Prefer memory → localStorage → IndexedDB (async hydrate into memory).
 * Use on editor open for larger trees that may live only in IDB.
 */
export async function loadTreeAsync(strategyId: string): Promise<GameTreeDocument> {
  const mem = memory.get(strategyId);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY(strategyId));
    if (raw) {
      const doc = normalizeTree(JSON.parse(raw), strategyId);
      if (doc) {
        memory.set(strategyId, doc);
        return doc;
      }
    }
  } catch {
    /* fall through to IDB */
  }
  const fromIdb = await idbGetTree(strategyId);
  if (fromIdb) {
    const doc = normalizeTree(fromIdb, strategyId) ?? fromIdb;
    memory.set(strategyId, doc);
    // Mirror slim copy into LS when possible (best-effort).
    writeLocalStorage(doc);
    return doc;
  }
  const fresh = createDocument(strategyId);
  memory.set(strategyId, fresh);
  return fresh;
}

/** Update memory immediately; persist to LS/IDB on debounce. */
export function saveTree(doc: GameTreeDocument): boolean {
  memory.set(doc.strategyId, doc);
  const id = doc.strategyId;
  const prev = saveTimers.get(id);
  if (prev != null) window.clearTimeout(prev);
  const t = window.setTimeout(() => {
    saveTimers.delete(id);
    flushTreeSave(id);
  }, SAVE_DEBOUNCE_MS);
  saveTimers.set(id, t);
  return true;
}

/** Flush pending debounce and write storage now. */
export function flushTreeSave(strategyId: string): boolean {
  const t = saveTimers.get(strategyId);
  if (t != null) {
    window.clearTimeout(t);
    saveTimers.delete(strategyId);
  }
  const doc = memory.get(strategyId);
  if (!doc) return false;
  const ok = writeLocalStorage(doc);
  void idbPutTree(cloneForStorage(doc));
  return ok;
}

/** Replace memory cache (e.g. after remote hydrate) and schedule persist. */
export function putTreeCache(doc: GameTreeDocument): void {
  memory.set(doc.strategyId, doc);
  saveTree(doc);
}

export function peekTreeCache(strategyId: string): GameTreeDocument | null {
  return memory.get(strategyId) ?? null;
}

export function clearTreeCache(strategyId?: string): void {
  if (strategyId) {
    memory.delete(strategyId);
    const t = saveTimers.get(strategyId);
    if (t != null) window.clearTimeout(t);
    saveTimers.delete(strategyId);
    return;
  }
  memory.clear();
  for (const t of saveTimers.values()) window.clearTimeout(t);
  saveTimers.clear();
}
