/** Pass focus from Analysis → Strategy editor after seeding a missing branch. */

import type { SeedFocus } from "./seedTreeFromSpots";

const key = (strategyId: string) => `pokerledger.editorFocus.v1.${strategyId}`;

export function stashEditorFocus(strategyId: string, focus: SeedFocus): void {
  try {
    sessionStorage.setItem(key(strategyId), JSON.stringify(focus));
  } catch {
    /* private mode */
  }
}

export function peekEditorFocus(strategyId: string): SeedFocus | null {
  try {
    const raw = sessionStorage.getItem(key(strategyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeedFocus;
    if (!parsed?.tipNodeId || !parsed?.paintNodeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function takeEditorFocus(strategyId: string): SeedFocus | null {
  const focus = peekEditorFocus(strategyId);
  if (!focus) return null;
  try {
    sessionStorage.removeItem(key(strategyId));
  } catch {
    /* ignore */
  }
  return focus;
}
