/** Labels for the aggressive action at each raise level. */
export type RaiseLabel = "RAISE" | "3-BET" | "SQUEEZE" | "4-BET" | "ALL-IN";

/**
 * Label for the *next* raise facing `raiseCount` prior raises.
 * Open + call(s) → SQUEEZE; open alone → 3-BET; then 4-BET → ALL-IN.
 */
export function nextRaiseLabel(
  raiseCount: number,
  callersAfterRaise = 0,
): RaiseLabel {
  if (raiseCount <= 0) return "RAISE";
  if (raiseCount === 1) return callersAfterRaise >= 1 ? "SQUEEZE" : "3-BET";
  if (raiseCount === 2) return "4-BET";
  return "ALL-IN";
}

/**
 * Label for a raise that was the Nth aggression on the path
 * (1 = open, 2 = 3-bet or squeeze, 3 = 4-bet, 4+ = all-in).
 */
export function raiseLabelAtIndex(
  raiseIndex: number,
  wasSqueeze = false,
): RaiseLabel {
  if (raiseIndex <= 1) return "RAISE";
  if (raiseIndex === 2) return wasSqueeze ? "SQUEEZE" : "3-BET";
  if (raiseIndex === 3) return "4-BET";
  return "ALL-IN";
}

/** Short word for history chips. */
export function shortRaiseWord(label: RaiseLabel): string {
  if (label === "RAISE") return "Raise";
  if (label === "3-BET") return "3-bet";
  if (label === "SQUEEZE") return "Squeeze";
  if (label === "4-BET") return "4-bet";
  return "All-in";
}

/** Pill / history text; ALL-IN always includes stack. */
export function formatRaiseLabel(
  label: RaiseLabel,
  sizingBB?: number | null,
  stackDepth?: number,
): string {
  if (label === "ALL-IN") {
    const stack = sizingBB ?? stackDepth;
    return stack != null ? `ALL-IN ${stack}bb` : "ALL-IN";
  }
  if (sizingBB != null && sizingBB > 0) return `${label} ${sizingBB}bb`;
  return label;
}
