import { Position, SpotKey, spotChartLabel, spotSupportsVillain } from "../types/strategy";

/** Top-level tree entry (like GTO Wizard roots). */
export type TreeRoot = "open" | "vs_open" | "squeeze" | "iso";

export type EditorNode = {
  root: TreeRoot;
  spotKey: SpotKey;
  /** Opener / raiser seat for villain-scoped spots */
  villain: Position | null;
  /** How many Raise drills deep from the root chart */
  depth: number;
};

export const TREE_ROOTS: { id: TreeRoot; label: string; hint: string }[] = [
  { id: "open", label: "Open", hint: "Неоткрытый банк · RFI" },
  { id: "vs_open", label: "vs Open", hint: "Против открытия с позиции" },
  { id: "squeeze", label: "Squeeze", hint: "Сквиз после опена и колла" },
  { id: "iso", label: "ISO", hint: "Изоляция лимперов" },
];

export function rootToNode(root: TreeRoot, villain: Position | null = null): EditorNode {
  switch (root) {
    case "open":
      return { root, spotKey: "rfi", villain: null, depth: 0 };
    case "vs_open":
      return { root, spotKey: "vs_open", villain, depth: 0 };
    case "squeeze":
      return { root, spotKey: "squeeze", villain, depth: 0 };
    case "iso":
      return { root, spotKey: "iso", villain: null, depth: 0 };
  }
}

/** After Hero Raise — go to the next decision node (GTO Wizard drill-down). */
export function raiseChild(node: EditorNode): EditorNode | null {
  switch (node.spotKey) {
    case "rfi":
      return { root: node.root, spotKey: "vs_3bet", villain: null, depth: node.depth + 1 };
    case "vs_open":
      // 3-bet done → next hero decision is facing a 4-bet
      return {
        root: node.root,
        spotKey: "vs_4bet",
        villain: node.villain,
        depth: node.depth + 1,
      };
    case "vs_3bet":
      return { root: node.root, spotKey: "vs_4bet", villain: node.villain, depth: node.depth + 1 };
    case "squeeze":
      return { root: node.root, spotKey: "vs_4bet", villain: node.villain, depth: node.depth + 1 };
    case "iso":
      return { root: node.root, spotKey: "vs_3bet", villain: null, depth: node.depth + 1 };
    case "vs_4bet":
      return null;
    default:
      return null;
  }
}

export function canRaiseDeeper(node: EditorNode): boolean {
  return raiseChild(node) != null;
}

export function crumbLabels(node: EditorNode, hero: Position): string[] {
  const crumbs: string[] = [];
  if (node.root === "open") {
    crumbs.push("Open");
    if (node.spotKey === "vs_3bet") crumbs.push("Raise", "vs 3-bet");
    if (node.spotKey === "vs_4bet") crumbs.push("Raise", "vs 3-bet", "Raise", "vs 4-bet");
  } else if (node.root === "vs_open") {
    crumbs.push("vs Open");
    if (node.villain) crumbs.push(`vs ${node.villain}`);
    else crumbs.push("общий");
    if (node.spotKey === "vs_4bet") crumbs.push("Raise", "vs 4-bet");
  } else if (node.root === "squeeze") {
    crumbs.push("Squeeze");
    if (node.villain) crumbs.push(`vs ${node.villain}`);
    if (node.spotKey === "vs_4bet") crumbs.push("Raise", "vs 4-bet");
  } else {
    crumbs.push("ISO");
    if (node.spotKey === "vs_3bet") crumbs.push("Raise", "vs 3-bet");
    if (node.spotKey === "vs_4bet") crumbs.push("Raise", "vs 3-bet", "Raise", "vs 4-bet");
  }
  // Ensure hero context is clear for the leaf
  void hero;
  return crumbs;
}

export function nodeTitle(node: EditorNode, hero: Position): string {
  const villain =
    spotSupportsVillain(node.spotKey) || node.spotKey === "vs_4bet" ? node.villain : null;
  return spotChartLabel(node.spotKey, hero, villain);
}

export function pathBack(node: EditorNode): EditorNode | null {
  if (node.depth <= 0) return null;
  if (node.root === "open") {
    if (node.spotKey === "vs_4bet") {
      return { root: "open", spotKey: "vs_3bet", villain: null, depth: 1 };
    }
    if (node.spotKey === "vs_3bet") {
      return { root: "open", spotKey: "rfi", villain: null, depth: 0 };
    }
  }
  if (node.root === "vs_open" && node.spotKey === "vs_4bet") {
    return { root: "vs_open", spotKey: "vs_open", villain: node.villain, depth: 0 };
  }
  if (node.root === "squeeze" && node.spotKey === "vs_4bet") {
    return { root: "squeeze", spotKey: "squeeze", villain: node.villain, depth: 0 };
  }
  if (node.root === "iso") {
    if (node.spotKey === "vs_4bet") {
      return { root: "iso", spotKey: "vs_3bet", villain: null, depth: 1 };
    }
    if (node.spotKey === "vs_3bet") {
      return { root: "iso", spotKey: "iso", villain: null, depth: 0 };
    }
  }
  return null;
}
