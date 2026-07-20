import { createDocument } from "./engine";
import { seatsFor } from "./seats";
import type { GameTreeDocument, GameTreeNode, Seat } from "./types";

const KEY = (strategyId: string) => `pokerledger.gameTree.v1.${strategyId}`;

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

export function loadTree(strategyId: string): GameTreeDocument {
  try {
    const raw = localStorage.getItem(KEY(strategyId));
    if (!raw) return createDocument(strategyId);
    const doc = normalizeTree(JSON.parse(raw), strategyId);
    return doc ?? createDocument(strategyId);
  } catch {
    return createDocument(strategyId);
  }
}

/** Returns false if storage failed (quota / private mode). */
export function saveTree(doc: GameTreeDocument): boolean {
  try {
    localStorage.setItem(KEY(doc.strategyId), JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}
