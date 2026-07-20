/**
 * IndexedDB store for constructor trees (localStorage remains sync fallback).
 */
import type { GameTreeDocument } from "./types";

const IDB_NAME = "pokerledger-gametree-v1";
const STORE = "trees";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "strategyId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("gameTree IDB open failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

export async function idbGetTree(
  strategyId: string,
): Promise<GameTreeDocument | null> {
  try {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(strategyId);
      req.onsuccess = () => {
        const row = req.result as { strategyId: string; doc: GameTreeDocument } | undefined;
        resolve(row?.doc ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error("idb get tree failed"));
    });
  } catch {
    return null;
  }
}

export async function idbPutTree(doc: GameTreeDocument): Promise<void> {
  try {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ strategyId: doc.strategyId, doc });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb put tree failed"));
    });
  } catch {
    /* quota / private mode */
  }
}

export async function idbDeleteTree(strategyId: string): Promise<void> {
  try {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(strategyId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb delete tree failed"));
    });
  } catch {
    /* ignore */
  }
}
