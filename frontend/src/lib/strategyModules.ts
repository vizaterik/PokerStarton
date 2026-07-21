/**
 * Strategy format modules: Cash / MTT / Spins presets and helpers.
 * Keep in sync with backend/app/services/strategy_modules.py
 */

export type StrategyFormat = "cash" | "mtt" | "spins";
export type TableSizeLabel = "2-max" | "3-max" | "6-max" | "8-max" | "9-max";
export type ActionMode = "standard" | "push_fold";
export type MttStage = "early" | "ante" | "bubble" | "final";

export type ModulePreset = {
  format: StrategyFormat;
  table_size: TableSizeLabel;
  stack_depth: string;
  mtt_stage: MttStage | null;
  action_mode: ActionMode;
  label: string;
};

export const FORMAT_OPTIONS: { id: StrategyFormat; title: string; lead: string }[] = [
  {
    id: "cash",
    title: "Кэш-игра",
    lead: "6-max · 100bb",
  },
  {
    id: "mtt",
    title: "МТТ",
    lead: "6-max / 8-max · стадии турнира",
  },
  {
    id: "spins",
    title: "Spin & Go",
    lead: "3-max · стеки 10–25bb",
  },
];

export const POSITIONS_BY_TABLE: Record<TableSizeLabel, string[]> = {
  "2-max": ["BTN", "BB"],
  "3-max": ["BTN", "SB", "BB"],
  "6-max": ["UTG", "MP", "CO", "BTN", "SB", "BB"],
  "8-max": ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  "9-max": ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
};

export const SITUATIONS: { key: string; label: string }[] = [
  { key: "rfi", label: "RFI" },
  { key: "iso", label: "ISO" },
  { key: "vs_open", label: "vs Open" },
  { key: "vs_3bet", label: "vs 3-Bet" },
  { key: "squeeze", label: "Squeeze" },
  { key: "vs_4bet", label: "vs 4-Bet" },
];

export const PUSH_FOLD_SITUATIONS: { key: string; label: string }[] = [
  { key: "rfi", label: "Push" },
  { key: "vs_open", label: "vs Push" },
];

export const CASH_PRESETS: ModulePreset[] = [
  {
    format: "cash",
    table_size: "6-max",
    stack_depth: "100bb",
    mtt_stage: null,
    action_mode: "standard",
    label: "Cash 6-max · 100bb",
  },
];

export const MTT_PRESETS: ModulePreset[] = [
  {
    format: "mtt",
    table_size: "6-max",
    stack_depth: "40bb",
    mtt_stage: "early",
    action_mode: "standard",
    label: "MTT 6-max · Ранняя стадия",
  },
  {
    format: "mtt",
    table_size: "6-max",
    stack_depth: "25bb",
    mtt_stage: "ante",
    action_mode: "standard",
    label: "MTT 6-max · Стадия анте",
  },
  {
    format: "mtt",
    table_size: "6-max",
    stack_depth: "15bb",
    mtt_stage: "bubble",
    action_mode: "push_fold",
    label: "MTT 6-max · Баббл (Push-Fold)",
  },
  {
    format: "mtt",
    table_size: "6-max",
    stack_depth: "12bb",
    mtt_stage: "final",
    action_mode: "push_fold",
    label: "MTT 6-max · Финал (Push-Fold)",
  },
  {
    format: "mtt",
    table_size: "8-max",
    stack_depth: "40bb",
    mtt_stage: "early",
    action_mode: "standard",
    label: "MTT 8-max · Ранняя стадия",
  },
  {
    format: "mtt",
    table_size: "8-max",
    stack_depth: "25bb",
    mtt_stage: "ante",
    action_mode: "standard",
    label: "MTT 8-max · Стадия анте",
  },
  {
    format: "mtt",
    table_size: "8-max",
    stack_depth: "15bb",
    mtt_stage: "bubble",
    action_mode: "push_fold",
    label: "MTT 8-max · Баббл (Push-Fold)",
  },
  {
    format: "mtt",
    table_size: "8-max",
    stack_depth: "12bb",
    mtt_stage: "final",
    action_mode: "push_fold",
    label: "MTT 8-max · Финал (Push-Fold)",
  },
];

export const SPINS_PRESETS: ModulePreset[] = [
  {
    format: "spins",
    table_size: "3-max",
    stack_depth: "25bb",
    mtt_stage: null,
    action_mode: "standard",
    label: "Spin & Go · 25bb",
  },
  {
    format: "spins",
    table_size: "3-max",
    stack_depth: "20bb",
    mtt_stage: null,
    action_mode: "standard",
    label: "Spin & Go · 20bb",
  },
  {
    format: "spins",
    table_size: "3-max",
    stack_depth: "15bb",
    mtt_stage: null,
    action_mode: "push_fold",
    label: "Spin & Go · 15bb Push-Fold",
  },
  {
    format: "spins",
    table_size: "3-max",
    stack_depth: "10bb",
    mtt_stage: null,
    action_mode: "push_fold",
    label: "Spin & Go · 10bb Push-Fold",
  },
];

export function presetsFor(format: StrategyFormat): ModulePreset[] {
  if (format === "mtt") return MTT_PRESETS;
  if (format === "spins") return SPINS_PRESETS;
  return CASH_PRESETS;
}

export function positionsFor(tableSize: string): string[] {
  return POSITIONS_BY_TABLE[tableSize as TableSizeLabel] ?? POSITIONS_BY_TABLE["6-max"];
}

export function situationsFor(actionMode: ActionMode | string): { key: string; label: string }[] {
  return actionMode === "push_fold" ? PUSH_FOLD_SITUATIONS : SITUATIONS;
}

export function parseStackBb(stackDepth: string): number {
  const s = stackDepth.trim().toLowerCase().replace(/\s/g, "").replace(/bb$/, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 100;
}

export function formatBadge(format: string): string {
  if (format === "mtt") return "MTT";
  if (format === "spins") return "Spins";
  return "Cash";
}

export function actionLabel(action: string, actionMode: ActionMode | string): string {
  if (actionMode === "push_fold") {
    if (action === "RAISE" || action === "raise") return "All-in";
    if (action === "FOLD" || action === "fold") return "Fold";
    if (action === "CALL" || action === "call") return "Call";
  }
  if (action === "FOLD" || action === "fold") return "Fold";
  if (action === "CALL" || action === "call") return "Call";
  if (action === "RAISE" || action === "raise") return "Raise";
  return action;
}

/** Map strategy table_size to game-tree TableSize (2 | 3 | 6 | 8 | 9). */
export function treeTableSize(tableSize: string): 2 | 3 | 6 | 8 | 9 {
  if (tableSize === "9-max") return 9;
  if (tableSize === "8-max") return 8;
  if (tableSize === "3-max") return 3;
  if (tableSize === "2-max") return 2;
  return 6;
}

export function treeStackDepth(stackDepth: string): number {
  return Math.round(parseStackBb(stackDepth));
}
