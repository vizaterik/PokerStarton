import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { StrategyDetail } from "../../api/client";
import { getStrategyTree, putStrategyTree } from "../../api/client";
import {
  alignDocMeta,
  commitAction,
  commitWithAutoFolds,
  deleteBranch,
  findNode,
  focusSeatWithAutoFolds,
  paintHandBatch,
  pathToNode,
  resetBranches,
} from "../../lib/gameTree/engine";
import {
  applyStylePreset,
  type StylePreset,
} from "../../lib/gameTree/branchPresets";
import { applyStrategyPreset, STRATEGY_PRESETS } from "../../lib/strategyPresets";
import {
  activeBranchId as resolveActiveBranchId,
  collectEditorBranches,
  shortSavedBranchLabel,
  type SavedBranch,
} from "../../lib/gameTree/branches";
import { branchStats } from "../../lib/gameTree/combos";
import { clearAnalysisCache } from "../../lib/analysisCache";
import { peekEditorFocus, takeEditorFocus } from "../../lib/gameTree/editorFocus";
import {
  flushTreeSave,
  loadTree,
  loadTreeAsync,
  normalizeTree,
  putTreeCache,
  saveTree,
} from "../../lib/gameTree/persist";
import { seatLabel } from "../../lib/gameTree/seats";
import { branchRangeSpots } from "../../lib/gameTree/rangeSpots";
import { buildSeatWindows, historyChainText, resumeNodeAfterSeat } from "../../lib/gameTree/seatView";
import { syncTreeChartsToDb } from "../../lib/gameTree/syncTreeCharts";
import { standardRaiseSize } from "../../lib/gameTree/standardSizings";
import { deriveContext } from "../../lib/gameTree/turnEngine";
import type {
  GameTreeDocument,
  GameTreeNode,
  PaintAction,
  Seat,
} from "../../lib/gameTree/types";
import {
  actionLabel,
  formatBadge,
  treeStackDepth,
  treeTableSize,
} from "../../lib/strategyModules";
import BranchPanel from "./BranchPanel";
import GtoMatrix from "./GtoMatrix";
import PreflopActionSelector from "./PreflopActionSelector";
import RangeSpotsBar from "./RangeSpotsBar";
import "../../pages/StrategiesPage.css";

type Props = {
  strategy: StrategyDetail;
};

const FREQ_WEIGHTS = [100, 75, 50, 25] as const;

/**
 * Solo open (one RAISE spot): sit on the raise edge so PreflopActionSelector
 * shows UTG·OPEN + brush — not the flop-tip shell.
 * Facing lines keep flop tip + paint node.
 */
function focusLineForPaint(
  root: GameTreeNode,
  tipNodeId: string,
  paintNodeId: string,
  stackDepth: number,
): { activeId: string; paintNodeId: string; paintAction?: PaintAction } {
  const tipPath = pathToNode(root, tipNodeId) ?? [];
  const spots = branchRangeSpots(tipPath, stackDepth).filter(
    (s) => s.lineAction === "RAISE" || s.lineAction === "CALL",
  );
  const paint =
    findNode(root, paintNodeId) ||
    (spots[0] ? findNode(root, spots[0].nodeId) : null);
  const openOnly =
    spots.length === 1 && spots[0].lineAction === "RAISE" && paint != null;
  if (openOnly && paint) {
    const raiseChild = paint.children.find((c) => c.actionTaken === "RAISE");
    return {
      activeId: raiseChild?.id ?? paint.id,
      paintNodeId: paint.id,
      paintAction: "RAISE",
    };
  }
  return {
    activeId: tipNodeId,
    paintNodeId: paint?.id ?? paintNodeId,
  };
}

export default function GtoTreeEditor({ strategy }: Props) {
  const strategyId = strategy.id;
  const strategyName = strategy.name;
  const pushFold = (strategy.action_mode ?? "standard") === "push_fold";
  const paintActions = useMemo(
    () => (pushFold ? (["FOLD", "RAISE"] as PaintAction[]) : (["FOLD", "CALL", "RAISE"] as PaintAction[])),
    [pushFold],
  );

  // One parse only — memory cache makes subsequent loadTree free.
  const [doc, setDoc] = useState<GameTreeDocument>(() => {
    const boot = loadTree(strategyId);
    return boot;
  });
  const [activeId, setActiveId] = useState(() => loadTree(strategyId).root.id);
  const [paintNodeId, setPaintNodeId] = useState(
    () => loadTree(strategyId).root.id,
  );
  const [paintAction, setPaintAction] = useState<PaintAction>("RAISE");
  const [weight, setWeight] = useState(100);
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [tab, setTab] = useState<"editor" | "branches">("editor");
  const [activeStyleId, setActiveStyleId] = useState<string | null>(
    () => loadTree(strategyId).stylePresetId ?? null,
  );
  const [hydrated, setHydrated] = useState(false);
  /** Branch list updates in a transition so paint stays snappy. */
  const [branchList, setBranchList] = useState<SavedBranch[]>([]);
  /** Skip heavy sync / branch collect while the brush stroke is active. */
  const brushActiveRef = useRef(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const paintActionRef = useRef(paintAction);
  paintActionRef.current = paintAction;
  const weightRef = useRef(weight);
  weightRef.current = weight;
  /** Pending cells for the current rAF flush, keyed by nodeId. */
  const pendingStrokesRef = useRef(
    new Map<string, Map<string, boolean>>(),
  );
  const paintRafRef = useRef(0);
  const [brushTick, setBrushTick] = useState(0);

  // Hydrate from server (source of truth) + local/IDB cache; never wipe painted branches.
  useEffect(() => {
    let cancelled = false;
    const ts = treeTableSize(strategy.table_size ?? "6-max");
    const sd = treeStackDepth(strategy.stack_depth ?? "100bb");

    async function hydrate() {
      const local = await loadTreeAsync(strategyId);
      let next = alignDocMeta(local, ts, sd);
      const pendingFocus = peekEditorFocus(strategyId);
      const keepSeededLocal =
        pendingFocus != null &&
        findNode(local.root, pendingFocus.tipNodeId) != null;

      try {
        const remote = await getStrategyTree(strategyId);
        const remoteDoc = normalizeTree(remote.tree, strategyId);
        if (remoteDoc && !keepSeededLocal) {
          const localEmpty = local.root.children.length === 0;
          const remoteHasData = remoteDoc.root.children.length > 0;
          const remoteNewer =
            Boolean(remoteDoc.updatedAt) &&
            (!local.updatedAt || remoteDoc.updatedAt >= local.updatedAt);
          if (remoteHasData && (localEmpty || remoteNewer)) {
            next = alignDocMeta(remoteDoc, ts, sd);
          } else if (!remoteHasData && !localEmpty) {
            // Push local cache up once if server is empty.
            next = alignDocMeta(local, ts, sd);
            void putStrategyTree(strategyId, next as unknown as Record<string, unknown>).catch(
              () => undefined,
            );
          } else {
            next = alignDocMeta(remoteDoc, ts, sd);
          }
        }
      } catch {
        /* offline — keep local */
      }

      if (cancelled) return;
      putTreeCache(next);
      setDoc(next);
      setActiveStyleId(next.stylePresetId ?? null);
      const focus = takeEditorFocus(strategyId);
      const tipOk = focus ? findNode(next.root, focus.tipNodeId) : null;
      // Jump into the seeded/saved line ready to paint (opens → build UI with OPEN).
      if (tipOk?.awaitingFlop && focus) {
        const applied = focusLineForPaint(
          next.root,
          focus.tipNodeId,
          focus.paintNodeId,
          next.stackDepth,
        );
        setActiveId(applied.activeId);
        setPaintNodeId(applied.paintNodeId);
        setPaintAction((prev) => {
          if (applied.paintAction) return applied.paintAction;
          return pushFold && prev === "CALL" ? "RAISE" : prev;
        });
        setTab("editor");
      } else {
        setActiveId(next.root.id);
        setPaintNodeId(next.root.id);
        setPaintAction((prev) => (pushFold && prev === "CALL" ? "RAISE" : prev));
      }
      setHydrated(true);
    }

    setHydrated(false);
    void hydrate();
    return () => {
      cancelled = true;
      flushTreeSave(strategyId);
    };
  }, [strategyId, strategy.table_size, strategy.stack_depth, pushFold]);

  useEffect(() => {
    if (!hydrated) return;
    saveTree(doc);
    setSavedFlash(true);
    const flashT = window.setTimeout(() => setSavedFlash(false), 500);
    // During a brush stroke: memory-only. Persist/API after brushTick bumps.
    if (brushActiveRef.current) {
      return () => window.clearTimeout(flashT);
    }
    const saveT = window.setTimeout(() => {
      void putStrategyTree(strategyId, doc as unknown as Record<string, unknown>).catch(
        () => undefined,
      );
    }, 900);
    return () => {
      window.clearTimeout(flashT);
      window.clearTimeout(saveT);
    };
  }, [doc, strategyId, hydrated, brushTick]);

  // Keep DB charts in sync on idle — worker computes jobs so paint stays free.
  useEffect(() => {
    if (!hydrated || brushActiveRef.current) return;
    let idleId = 0;
    let timeoutId = 0;
    const run = () => {
      void syncTreeChartsToDb(strategyId, docRef.current).catch(() => {
        /* offline / validation — tree still saved locally + on strategy */
      });
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(run, { timeout: 2000 });
      } else {
        timeoutId = window.setTimeout(run, 1200);
      }
    };
    timeoutId = window.setTimeout(schedule, 1000);
    return () => {
      window.clearTimeout(timeoutId);
      if (idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [doc, strategyId, hydrated, brushTick]);

  // Branch sidebar — deferred so brush strokes don't wait on collectEditorBranches.
  useEffect(() => {
    if (brushActiveRef.current) return;
    startTransition(() => {
      setBranchList(collectEditorBranches(doc.root));
    });
  }, [doc.root, brushTick]);

  const active = findNode(doc.root, activeId) ?? doc.root;
  const rawPaint = findNode(doc.root, paintNodeId) ?? active;
  /** Never paint on flop-prompt nodes — use the last decision seat instead */
  const paintNode = useMemo(() => {
    if (!rawPaint.awaitingFlop) return rawPaint;
    const p = pathToNode(doc.root, rawPaint.id);
    return p && p.length >= 2 ? p[p.length - 2] : rawPaint;
  }, [rawPaint, doc.root]);
  const path = useMemo(
    () => pathToNode(doc.root, active.id) ?? [doc.root],
    [doc.root, active.id],
  );
  const windows = useMemo(
    () => buildSeatWindows(path, active, doc.stackDepth, doc.tableSize),
    [path, active, doc.stackDepth, doc.tableSize],
  );
  const history = useMemo(
    () => historyChainText(path, active, doc.stackDepth),
    [path, active, doc.stackDepth],
  );

  const stats = useMemo(() => {
    return branchStats(paintNode, "RAISE");
  }, [paintNode]);

  const awaitingFlop = Boolean(active.awaitingFlop);
  const editingSeat = paintNode.awaitingFlop ? null : paintNode.activePlayer;
  const branchTitle = useMemo(() => {
    if (!awaitingFlop || path.length < 2) return null;
    return shortSavedBranchLabel(path);
  }, [awaitingFlop, path]);
  const branchPotTag = useMemo(() => {
    if (!awaitingFlop || path.length < 2) return null;
    const chip = history.find((h) => h.potTag) ?? history[0];
    return chip?.potTag ?? null;
  }, [awaitingFlop, path.length, history]);

  const branches = branchList;
  const currentBranchId = useMemo(
    () => resolveActiveBranchId(branches, activeId, doc.root),
    [branches, activeId, doc.root],
  );
  /** Decision seats on the current line — full F/C/R mix per seat */
  const rangeSpots = useMemo(() => {
    const all = branchRangeSpots(path, doc.stackDepth);
    // Closed branch: only seats that saw the flop (no fold noise)
    if (active.awaitingFlop) {
      return all.filter((s) => s.lineAction === "RAISE" || s.lineAction === "CALL");
    }
    return all;
  }, [path, doc.stackDepth, active.awaitingFlop]);
  const rangeSpotViews = useMemo(
    () =>
      rangeSpots.map((spot) => {
        const node = findNode(doc.root, spot.nodeId);
        const st = node ? branchStats(node, "RAISE") : [];
        const raise = st.find((s) => s.action === "RAISE");
        const call = st.find((s) => s.action === "CALL");
        const fold = st.find((s) => s.action === "FOLD");
        return {
          ...spot,
          raisePct: raise?.pct ?? 0,
          callPct: call?.pct ?? 0,
          foldPct: fold?.pct ?? 0,
        };
      }),
    [rangeSpots, doc.root],
  );
  const activeRangeSpot = useMemo(
    () => rangeSpots.find((s) => s.nodeId === paintNode.id) ?? null,
    [rangeSpots, paintNode.id],
  );

  /**
   * Два ренджа рядом: агрессор → ответчик в этой ветке.
   * UTG Raise | BTN Call/3-bet · BTN 3-bet | BB Call/4-bet и т.д.
   * Правый спот — следующий Call или Raise после левого Raise (фолды пропускаем).
   */
  const dualRanges = useMemo(() => {
    if (pushFold || rangeSpotViews.length < 2) return null;

    const isDecision = (s: { lineAction: string }) =>
      s.lineAction === "RAISE" || s.lineAction === "CALL";

    const nextFacing = (afterIdx: number) =>
      rangeSpotViews.slice(afterIdx + 1).find(isDecision) ?? null;

    const prevRaise = (beforeIdx: number) =>
      [...rangeSpotViews.slice(0, beforeIdx)]
        .reverse()
        .find((s) => s.lineAction === "RAISE") ?? null;

    let left = null as (typeof rangeSpotViews)[number] | null;
    let right = null as (typeof rangeSpotViews)[number] | null;

    if (activeRangeSpot?.lineAction === "RAISE") {
      left =
        rangeSpotViews.find((s) => s.nodeId === activeRangeSpot.nodeId) ?? null;
      const idx = rangeSpotViews.findIndex((s) => s.nodeId === left?.nodeId);
      right = idx >= 0 ? nextFacing(idx) : null;
    } else if (activeRangeSpot && isDecision(activeRangeSpot)) {
      // Call / ответчик: слева рейз, на который он отвечает
      right =
        rangeSpotViews.find((s) => s.nodeId === activeRangeSpot.nodeId) ?? null;
      const idx = rangeSpotViews.findIndex((s) => s.nodeId === right?.nodeId);
      left = idx >= 0 ? prevRaise(idx) : null;
    } else {
      // По умолчанию — последний рейз на линии, у которого есть ответчик
      for (let i = rangeSpotViews.length - 1; i >= 0; i -= 1) {
        if (rangeSpotViews[i].lineAction !== "RAISE") continue;
        const facing = nextFacing(i);
        if (facing) {
          left = rangeSpotViews[i];
          right = facing;
          break;
        }
      }
    }

    if (!left || !right || left.nodeId === right.nodeId) return null;

    const leftNode = findNode(doc.root, left.nodeId);
    const rightNode = findNode(doc.root, right.nodeId);
    if (!leftNode || !rightNode) return null;

    return {
      raise: {
        nodeId: left.nodeId,
        label: left.label,
        lineAction: left.lineAction,
        ranges: leftNode.ranges,
        raisePct: left.raisePct,
        callPct: left.callPct,
      },
      call: {
        nodeId: right.nodeId,
        label: right.label,
        lineAction: right.lineAction,
        ranges: rightNode.ranges,
        raisePct: right.raisePct,
        callPct: right.callPct,
      },
    };
  }, [pushFold, rangeSpotViews, activeRangeSpot, doc.root]);

  function flushPendingPaints() {
    paintRafRef.current = 0;
    const pending = pendingStrokesRef.current;
    if (!pending.size) return;
    pendingStrokesRef.current = new Map();
    const action = paintActionRef.current;
    const w = weightRef.current / 100;
    setDoc((prev) => {
      let next = prev;
      for (const [nodeId, hands] of pending) {
        const strokes = [...hands.entries()].map(([hand, erase]) => ({
          hand,
          erase,
        }));
        next = paintHandBatch(next, nodeId, strokes, action, w);
      }
      return next;
    });
  }

  function queuePaint(nodeId: string, hand: string, erase = false) {
    let bucket = pendingStrokesRef.current.get(nodeId);
    if (!bucket) {
      bucket = new Map();
      pendingStrokesRef.current.set(nodeId, bucket);
    }
    bucket.set(hand, erase);
    if (!paintRafRef.current) {
      paintRafRef.current = window.requestAnimationFrame(flushPendingPaints);
    }
  }

  function onBrushStart() {
    brushActiveRef.current = true;
  }

  function onBrushEnd() {
    if (paintRafRef.current) {
      window.cancelAnimationFrame(paintRafRef.current);
      flushPendingPaints();
    }
    brushActiveRef.current = false;
    setBrushTick((n) => n + 1);
  }

  function onPaint(hand: string, erase = false) {
    queuePaint(paintNode.id, hand, erase);
  }

  function onPaintNode(nodeId: string, hand: string, erase = false) {
    if (paintNodeId !== nodeId) setPaintNodeId(nodeId);
    queuePaint(nodeId, hand, erase);
  }

  /**
   * Active / waiting: commit forward (with auto-folds if skip-ahead).
   * Past seat: switch sibling edge under that seat's decision node only.
   * Raise sizing = стандарт GTO Wizard (без запроса у пользователя).
   */
  function onWindowAction(
    position: Seat,
    action: "FOLD" | "CALL" | "RAISE",
    sizingBB?: number,
  ) {
    const win = windows.find((w) => w.seat === position);
    if (!win) return;

    let raiseSize = sizingBB;
    if (action === "RAISE" && raiseSize == null) {
      const decisionId = win.nodeId ?? activeId;
      const decisionPath = pathToNode(doc.root, decisionId) ?? path;
      raiseSize = standardRaiseSize(
        deriveContext(decisionPath),
        position,
        doc.stackDepth,
      );
    }

    // Same action → range only (для RAISE сравниваем сайз: 4-bet ≠ all-in)
    if (win.lockedAction === action && win.nodeId) {
      if (action !== "RAISE") {
        setPaintNodeId(win.nodeId);
        setSelectedHand(null);
        return;
      }
      const sameSize =
        raiseSize != null &&
        win.lockedSizing != null &&
        Math.abs(win.lockedSizing - raiseSize) < 0.05;
      if (sameSize) {
        setPaintNodeId(win.nodeId);
        setSelectedHand(null);
        return;
      }
    }

    if (
      win.nodeId &&
      (win.status === "locked" ||
        win.status === "folded" ||
        win.status === "auto-folded")
    ) {
      const result = commitAction(doc, win.nodeId, action, raiseSize);
      setDoc(result.doc);
      if (result.childId) {
        setActiveId(result.childId);
        setPaintNodeId(win.nodeId);
        setSelectedHand(null);
      }
      return;
    }

    const { doc: next, childId } = commitWithAutoFolds(
      doc,
      activeId,
      position,
      action,
      raiseSize,
    );
    setDoc(next);
    if (childId) {
      setActiveId(childId);
      const p = pathToNode(next.root, childId);
      const actedNode = p && p.length >= 2 ? p[p.length - 2] : null;
      setPaintNodeId(actedNode?.id ?? childId);
      setSelectedHand(null);
    }
  }

  /** Open full seat range — и вернуть построение после этой позиции. */
  function onEditRange(position: Seat) {
    const win = windows.find((w) => w.seat === position);
    if (!win) return;

    const past =
      win.status === "locked" ||
      win.status === "folded" ||
      win.status === "auto-folded";

    if (win.nodeId && past) {
      // Полный path до tip (даже если active — mid-line): ищем действие позиции
      const tipPath =
        pathToNode(doc.root, activeId) ??
        path;
      const resumeId = resumeNodeAfterSeat(tipPath, position, win.nodeId);
      if (resumeId) {
        setActiveId(resumeId);
      }
      setPaintNodeId(win.nodeId);
      setSelectedHand(null);
      return;
    }

    if (position === active.activePlayer) {
      setPaintNodeId(active.id);
      setSelectedHand(null);
      return;
    }

    const { doc: next, nodeId } = focusSeatWithAutoFolds(doc, activeId, position);
    setDoc(next);
    setActiveId(nodeId);
    setPaintNodeId(nodeId);
    setSelectedHand(null);
  }

  /** History chip: navigate into that spot without deleting sibling branches. */
  function onRewind(nodeId: string) {
    setActiveId(nodeId);
    setPaintNodeId(nodeId);
    setSelectedHand(null);
  }

  /** С закрытой ветки (флоп) — назад к окнам позиций / построению линии. */
  function onResumeBuilding() {
    if (path.length < 2) return;
    const lastDecision = path[path.length - 2];
    setActiveId(lastDecision.id);
    setPaintNodeId(lastDecision.id);
    setSelectedHand(null);
  }

  /** Ещё на шаг назад по истории (если есть). */
  function onBackOneStep() {
    if (path.length < 3) {
      onResumeBuilding();
      return;
    }
    const prev = path[path.length - 3];
    setActiveId(prev.id);
    setPaintNodeId(prev.id);
    setSelectedHand(null);
  }

  function onOpenBranch(branch: SavedBranch) {
    const applied = focusLineForPaint(
      doc.root,
      branch.tipNodeId,
      branch.paintNodeId,
      doc.stackDepth,
    );
    setActiveId(applied.activeId);
    setPaintNodeId(applied.paintNodeId);
    if (applied.paintAction) setPaintAction(applied.paintAction);
    setSelectedHand(null);
    setTab("editor");
  }

  function onSelectRangeSpot(nodeId: string) {
    // На флопе клик по позиции только переключает рендж — выход кнопкой «К построению».
    if (awaitingFlop) {
      setPaintNodeId(nodeId);
      setSelectedHand(null);
      return;
    }
    const node = findNode(doc.root, nodeId);
    if (node && !node.awaitingFlop) {
      // Спот = decision node позиции: вернуть построение после её действия
      const tipPath = pathToNode(doc.root, activeId) ?? path;
      const seat = node.activePlayer;
      const resumeId = resumeNodeAfterSeat(tipPath, seat, nodeId);
      if (resumeId) setActiveId(resumeId);
    }
    setPaintNodeId(nodeId);
    setSelectedHand(null);
  }

  function onDeleteBranch(branch: SavedBranch) {
    const { doc: next, rootId } = deleteBranch(doc, branch.tipNodeId);
    setDoc(next);
    clearAnalysisCache(strategyId);
    const stillActive = findNode(next.root, activeId);
    const stillPaint = findNode(next.root, paintNodeId);
    if (!stillActive) {
      setActiveId(rootId);
      setPaintNodeId(rootId);
      setSelectedHand(null);
    } else if (!stillPaint) {
      setPaintNodeId(stillActive.id);
      setSelectedHand(null);
    }
  }

  function onResetAllBranches() {
    const next: GameTreeDocument = {
      ...resetBranches(doc),
      stylePresetId: null,
    };
    setDoc(next);
    clearAnalysisCache(strategyId);
    setActiveStyleId(null);
    setActiveId(next.root.id);
    setPaintNodeId(next.root.id);
    setSelectedHand(null);
  }

  async function onApplyPreset(preset: StylePreset) {
    const { doc: applied } = applyStylePreset(doc, preset);
    const next: GameTreeDocument = {
      ...applied,
      stylePresetId: preset.id,
      updatedAt: new Date().toISOString(),
    };
    setDoc(next);
    setActiveStyleId(preset.id);
    setActiveId(next.root.id);
    setPaintNodeId(next.root.id);
    setSelectedHand(null);
    setTab("branches");
    // Sync the same charts into DB so Preflop analysis matches the style.
    const chartPreset = STRATEGY_PRESETS.find((p) => p.id === preset.strategyId);
    if (chartPreset) {
      try {
        await applyStrategyPreset(strategyId, chartPreset);
      } catch {
        /* tree still applied; analysis charts may be stale until retry */
      }
    }
  }

  return (
    <div className="gto-shell">
      <header className="gto-top">
        <div className="gto-top-left">
          <Link className="gto-back" to="/strategies">
            ← Стратегии
          </Link>
          <h1 className="gto-title">{strategyName}</h1>
          <span className="gto-meta-badges">
            <em>{formatBadge(strategy.format ?? "cash")}</em>
            <em>{strategy.table_size ?? "6-max"}</em>
            <em>{strategy.stack_depth ?? "100bb"}</em>
            {pushFold ? <em>Push-Fold</em> : null}
          </span>
        </div>
        <div className="gto-top-right">
          <span className={`gto-save-pill${savedFlash ? " flash" : ""}`}>
            {savedFlash ? "Saved" : "Auto-save"}
          </span>
        </div>
      </header>

      <nav className="gto-tabs" aria-label="Strategy sections">
        <button
          type="button"
          className={`gto-tab${tab === "editor" ? " is-active" : ""}`}
          onClick={() => setTab("editor")}
        >
          Конструктор
        </button>
        <button
          type="button"
          className={`gto-tab${tab === "branches" ? " is-active" : ""}`}
          onClick={() => setTab("branches")}
        >
          Ветки
          {branches.length > 0 ? (
            <span className="gto-tab-badge">{branches.length}</span>
          ) : null}
        </button>
      </nav>

      {tab === "branches" ? (
        <BranchPanel
          strategyId={strategyId}
          doc={doc}
          branches={branches}
          activeBranchId={currentBranchId}
          activeStyleId={activeStyleId}
          tableSize={doc.tableSize}
          stackDepth={doc.stackDepth}
          onOpen={onOpenBranch}
          onDelete={onDeleteBranch}
          onResetAll={onResetAllBranches}
          onApplyPreset={onApplyPreset}
          onSpotAdded={(next, focus) => {
            const stamped = { ...next, updatedAt: new Date().toISOString() };
            setDoc(stamped);
            const tip = findNode(stamped.root, focus.tipNodeId);
            if (!tip?.awaitingFlop) {
              // Incomplete line — stay on branches with a clear failure path.
              setSelectedHand(null);
              setTab("branches");
              return;
            }
            const applied = focusLineForPaint(
              stamped.root,
              focus.tipNodeId,
              focus.paintNodeId,
              stamped.stackDepth,
            );
            setActiveId(applied.activeId);
            setPaintNodeId(applied.paintNodeId);
            if (applied.paintAction) setPaintAction(applied.paintAction);
            setSelectedHand(null);
            setTab("editor");
          }}
        />
      ) : (
        <>
          <div className="gto-selector-slot gto-selector-slot-mwb">
            {awaitingFlop ? (
              <div className="pas pas-branch">
                <header className="pas-branch-head">
                  <div className="pas-branch-title">
                    {branchPotTag ? (
                      <span className="pas-branch-pot">#{branchPotTag}</span>
                    ) : (
                      <span className="pas-branch-kicker">Ветка</span>
                    )}
                    <strong>{branchTitle ?? "Линия"}</strong>
                  </div>
                  <div className="pas-branch-tools">
                    {currentBranchId ? (
                      <em className="pas-branch-index">
                        #
                        {branches.find((b) => b.id === currentBranchId)?.index ??
                          "—"}
                      </em>
                    ) : null}
                    <button
                      type="button"
                      className="pas-branch-back"
                      onClick={onResumeBuilding}
                      title="Вернуться к окнам позиций и построению линии"
                    >
                      ← К построению
                    </button>
                    <button
                      type="button"
                      className="pas-branch-back ghost"
                      onClick={onBackOneStep}
                      title="На шаг назад по линии"
                    >
                      Шаг назад
                    </button>
                  </div>
                </header>
                <div className="pas-history pas-history-flop" aria-label="Flop seats">
                  {history.map((h, i) => (
                    <span key={`${h.nodeId}-${i}`} className="pas-history-item">
                      {i > 0 ? <span className="pas-history-arrow">→</span> : null}
                      <button
                        type="button"
                        className={`pas-history-chip${
                          paintNode.id === h.nodeId ? " is-current" : ""
                        }`}
                        onClick={() => onSelectRangeSpot(h.nodeId)}
                      >
                        {h.text}
                      </button>
                    </span>
                  ))}
                </div>
                <RangeSpotsBar
                  spots={rangeSpotViews}
                  activeNodeId={paintNode.id}
                  onSelect={onSelectRangeSpot}
                  title="На флопе"
                  subtitle="только позиции в банке · полный рендж"
                />
              </div>
            ) : (
              <>
                <PreflopActionSelector
                  windows={windows}
                  history={history}
                  stackDepth={doc.stackDepth}
                  editingSeat={editingSeat}
                  onWindowAction={onWindowAction}
                  onEditRange={onEditRange}
                  onRewind={onRewind}
                />
                <RangeSpotsBar
                  spots={rangeSpotViews}
                  activeNodeId={paintNode.id}
                  onSelect={onSelectRangeSpot}
                  title="Ренджи"
                  subtitle={
                    pushFold
                      ? "Push-Fold · кисть All-in / Fold"
                      : "позиция → полный рендж · кисть ниже"
                  }
                />
              </>
            )}
          </div>

          <div className="gto-paint-bar">
            <span className="gto-paint-label">Кисть</span>
            {paintActions.map((a) => (
              <button
                key={a}
                type="button"
                className={`gto-paint ${a.toLowerCase()}${paintAction === a ? " active" : ""}`}
                onClick={() => setPaintAction(a)}
              >
                {actionLabel(a, pushFold ? "push_fold" : "standard")}
              </button>
            ))}
            <span className="gto-paint-label">Частота</span>
            {FREQ_WEIGHTS.map((w) => (
              <button
                key={w}
                type="button"
                className={`gto-freq${weight === w ? " active" : ""}`}
                onClick={() => setWeight(w)}
              >
                {w}%
              </button>
            ))}
            <span className="gto-paint-hint">
              {activeRangeSpot
                ? activeRangeSpot.label
                : seatLabel(paintNode.activePlayer)}
              {currentBranchId
                ? ` · #${branches.find((b) => b.id === currentBranchId)?.index ?? "?"}`
                : ""}
            </span>
          </div>

          <div className="gto-workspace">
            <div className="gto-workspace-main">
              <div
                className={`gto-matrix-stack${dualRanges ? " has-dual" : ""}`}
              >
                {dualRanges ? (
                  <>
                    <div
                      className={`gto-matrix-panel${
                        paintNode.id === dualRanges.raise.nodeId ? " is-focus" : ""
                      }`}
                    >
                      <div className="gto-matrix-panel-head">
                        <h3>{dualRanges.raise.label}</h3>
                        <span>
                          R {dualRanges.raise.raisePct.toFixed(0)}% · C{" "}
                          {dualRanges.raise.callPct.toFixed(0)}% · клик = рисовать
                        </span>
                      </div>
                      <GtoMatrix
                        ranges={dualRanges.raise.ranges}
                        paintAction={paintAction}
                        weight={weight}
                        selected={
                          paintNode.id === dualRanges.raise.nodeId
                            ? selectedHand
                            : null
                        }
                        onPaint={(hand, erase) =>
                          onPaintNode(dualRanges.raise.nodeId, hand, erase)
                        }
                        onSelect={(hand) => {
                          setPaintNodeId(dualRanges.raise.nodeId);
                          setSelectedHand(hand);
                        }}
                        onBrushStart={onBrushStart}
                        onBrushEnd={onBrushEnd}
                        actionMode={pushFold ? "push_fold" : "standard"}
                      />
                    </div>
                    <div
                      className={`gto-matrix-panel gto-matrix-panel-call${
                        paintNode.id === dualRanges.call.nodeId ? " is-focus" : ""
                      }`}
                    >
                      <div className="gto-matrix-panel-head">
                        <h3>{dualRanges.call.label}</h3>
                        <span>
                          R {dualRanges.call.raisePct.toFixed(0)}% · C{" "}
                          {dualRanges.call.callPct.toFixed(0)}% · клик = рисовать
                        </span>
                      </div>
                      <GtoMatrix
                        ranges={dualRanges.call.ranges}
                        paintAction={paintAction}
                        weight={weight}
                        selected={
                          paintNode.id === dualRanges.call.nodeId
                            ? selectedHand
                            : null
                        }
                        onPaint={(hand, erase) =>
                          onPaintNode(dualRanges.call.nodeId, hand, erase)
                        }
                        onSelect={(hand) => {
                          setPaintNodeId(dualRanges.call.nodeId);
                          setSelectedHand(hand);
                        }}
                        onBrushStart={onBrushStart}
                        onBrushEnd={onBrushEnd}
                        actionMode={pushFold ? "push_fold" : "standard"}
                      />
                    </div>
                  </>
                ) : (
                  <div className="gto-matrix-panel">
                    <div className="gto-matrix-panel-head">
                      <h3>
                        {activeRangeSpot?.label ??
                          seatLabel(paintNode.activePlayer)}
                      </h3>
                      <span>
                        {pushFold
                          ? "Push-Fold · All-in / Fold"
                          : "полный рендж · кисть Fold / Call / Raise"}
                      </span>
                    </div>
                    <GtoMatrix
                      ranges={paintNode.ranges}
                      paintAction={paintAction}
                      weight={weight}
                      selected={selectedHand}
                      onPaint={onPaint}
                      onSelect={setSelectedHand}
                      onBrushStart={onBrushStart}
                      onBrushEnd={onBrushEnd}
                      actionMode={pushFold ? "push_fold" : "standard"}
                    />
                  </div>
                )}
              </div>
            </div>
            <aside className="gto-sidebar">
              <h2>Диапазон</h2>
              <p className="gto-sidebar-seat">
                {activeRangeSpot?.label ?? seatLabel(paintNode.activePlayer)}
              </p>
              <ul className="gto-range-list">
                {stats.map((s) => (
                  <li key={s.action} className={`gto-range-row ${s.action.toLowerCase()}`}>
                    <div>
                      <strong>{s.label}</strong>
                      <span>{s.combos.toFixed(1)} combos</span>
                    </div>
                    <em>{s.pct.toFixed(1)}%</em>
                  </li>
                ))}
              </ul>
              {dualRanges ? (
                <div className="gto-facing-call">
                  <h3>Рейз → ответ</h3>
                  <p>
                    <strong>
                      {dualRanges.raise.label} → {dualRanges.call.label}
                    </strong>
                  </p>
                </div>
              ) : null}
              {rangeSpotViews.length > 0 ? (
                <div className="gto-spot-summary">
                  <h3>По линии</h3>
                  <ul>
                    {rangeSpotViews.map((s) => (
                      <li key={s.nodeId}>
                        <button
                          type="button"
                          className={
                            activeRangeSpot?.nodeId === s.nodeId ? "is-active" : ""
                          }
                          onClick={() => onSelectRangeSpot(s.nodeId)}
                        >
                          <span>{s.label}</span>
                          <em>
                            R{s.raisePct.toFixed(0)} / C{s.callPct.toFixed(0)}
                          </em>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {selectedHand ? (
                <div className="gto-hand-detail">
                  <h3>{selectedHand}</h3>
                  {paintActions.map((a) => {
                    const v = paintNode.ranges[selectedHand]?.[a] ?? 0;
                    return (
                      <div key={a} className="gto-hand-line">
                        <span className={a.toLowerCase()}>
                          {actionLabel(a, pushFold ? "push_fold" : "standard")}
                        </span>
                        <strong>{Math.round(v * 100)}%</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="gto-sidebar-hint">
                  {dualRanges
                    ? "Рисуй на любой из двух матриц — кисть общая."
                    : "После рейза и ответа на линии появятся два ренджа рядом."}
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
