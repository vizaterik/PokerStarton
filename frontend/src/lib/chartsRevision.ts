/**
 * Local revision of strategy charts so Analysis can detect playbook edits
 * without re-parsing the hand history.
 */

const PREFIX = "pokerledger.chartsRev.v1:";

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function readChartsRevision(strategyId: string): string | null {
  if (!strategyId) return null;
  try {
    return storage()?.getItem(PREFIX + strategyId) ?? null;
  } catch {
    return null;
  }
}

export function writeChartsRevision(strategyId: string, rev: string): void {
  if (!strategyId || !rev) return;
  try {
    storage()?.setItem(PREFIX + strategyId, rev);
  } catch {
    /* ignore */
  }
}

/** Stable fingerprint of painted charts (no timestamp — same paint ⇒ same rev). */
export function setChartsRevision(strategyId: string, fingerprint: string): string {
  const rev = fingerprint || "empty";
  writeChartsRevision(strategyId, rev);
  return rev;
}
