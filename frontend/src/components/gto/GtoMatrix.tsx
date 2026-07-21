import { CSSProperties, useEffect, useRef } from "react";
import { handCodeAt, RANKS } from "../../lib/handMatrix";
import {
  handMatchesPaintBrush,
  type PaintBrush,
} from "../../lib/gameTree/engine";
import {
  PAINT_CALL,
  PAINT_FOLD,
  type RaisePaintTier,
  raiseColorForTier,
} from "../../lib/gameTree/paintColors";
import type { HandMix, PaintAction } from "../../lib/gameTree/types";

type Props = {
  ranges: Record<string, HandMix>;
  paintAction: PaintAction;
  weight: number;
  /** Dual-mix brush (default paint path when mix mode on). */
  brush?: PaintBrush;
  /** RAISE band color tier for this node (open / 3bet / 4bet). */
  raiseTier?: RaisePaintTier;
  selected?: string | null;
  onPaint?: (handCode: string, erase?: boolean) => void;
  onSelect?: (handCode: string) => void;
  /** Preview matrix — no painting */
  readOnly?: boolean;
  /** When push_fold, RAISE band is treated as All-in visually (same colors). */
  actionMode?: "standard" | "push_fold";
  onBrushStart?: () => void;
  onBrushEnd?: () => void;
};

function cellStyle(mix: HandMix, raiseHex: string): CSSProperties {
  const r = mix.RAISE;
  const c = mix.CALL;
  const raiseEnd = r * 100;
  const callEnd = (r + c) * 100;
  return {
    background: `linear-gradient(90deg,
      ${raiseHex} 0%,
      ${raiseHex} ${raiseEnd}%,
      ${PAINT_CALL} ${raiseEnd}%,
      ${PAINT_CALL} ${callEnd}%,
      ${PAINT_FOLD} ${callEnd}%,
      ${PAINT_FOLD} 100%)`,
  };
}

function badge(mix: HandMix): string | null {
  const r = mix.RAISE;
  const c = mix.CALL;
  if (r < 0.02 && c < 0.02) return null;
  if (r >= 0.98) return "100";
  if (c >= 0.98) return "100";
  if (r > 0.02 && c > 0.02) return `${Math.round(r * 100)}/${Math.round(c * 100)}`;
  if (r > 0.02) return String(Math.round(r * 100));
  return String(Math.round(c * 100));
}

function handUnderPoint(clientX: number, clientY: number, root: HTMLElement | null): string | null {
  if (!root) return null;
  const el = document.elementFromPoint(clientX, clientY);
  if (!el || !(el instanceof Element)) return null;
  const cell = el.closest("[data-hand]");
  if (!cell || !root.contains(cell)) return null;
  return (cell as HTMLElement).dataset.hand || null;
}

export default function GtoMatrix({
  ranges,
  paintAction,
  weight,
  brush,
  raiseTier = "open",
  selected,
  onPaint,
  onSelect,
  readOnly = false,
  actionMode = "standard",
  onBrushStart,
  onBrushEnd,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const painting = useRef(false);
  /** Locked for the whole drag stroke so drag doesn't flicker paint/erase. */
  const strokeErase = useRef(false);
  const lastHand = useRef<string | null>(null);
  const onPaintRef = useRef(onPaint);
  const onSelectRef = useRef(onSelect);
  const onBrushStartRef = useRef(onBrushStart);
  const onBrushEndRef = useRef(onBrushEnd);
  onPaintRef.current = onPaint;
  onSelectRef.current = onSelect;
  onBrushStartRef.current = onBrushStart;
  onBrushEndRef.current = onBrushEnd;

  const raiseHex = raiseColorForTier(raiseTier);
  const activeBrush: PaintBrush =
    brush ??
    ({ mode: "action", action: paintAction, weight: weight / 100 } as PaintBrush);

  function endStroke() {
    if (!painting.current) return;
    painting.current = false;
    lastHand.current = null;
    onBrushEndRef.current?.();
  }

  function strokeHand(code: string, select = false) {
    if (lastHand.current === code) return;
    lastHand.current = code;
    if (select) onSelectRef.current?.(code);
    onPaintRef.current?.(code, strokeErase.current);
  }

  useEffect(() => {
    const onUp = () => endStroke();
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const brushClass =
    activeBrush.mode === "mix"
      ? "brush-mix"
      : `brush-${activeBrush.action.toLowerCase()}`;

  return (
    <div
      ref={rootRef}
      className={`gto-matrix ${brushClass}${readOnly ? " is-readonly" : ""}${actionMode === "push_fold" ? " is-push-fold" : ""} tier-${raiseTier}`}
      style={
        {
          touchAction: readOnly ? undefined : "none",
          ["--gto-raise" as string]: raiseHex,
        } as CSSProperties
      }
    >
      <div className="gto-matrix-corner" />
      {RANKS.map((rank) => (
        <div key={`c-${rank}`} className="gto-matrix-label">
          {rank}
        </div>
      ))}
      {RANKS.map((rowRank, row) => (
        <div key={`r-${rowRank}`} className="gto-matrix-row">
          <div className="gto-matrix-label">{rowRank}</div>
          {RANKS.map((_, col) => {
            const code = handCodeAt(row, col);
            const mix = ranges[code] ?? { FOLD: 1, CALL: 0, RAISE: 0 };
            const isSelected = selected === code;
            return (
              <button
                key={code}
                type="button"
                data-hand={code}
                className={`gto-matrix-cell${isSelected ? " selected" : ""}`}
                style={cellStyle(mix, raiseHex)}
                title={`${code} — R ${Math.round(mix.RAISE * 100)}% · C ${Math.round(mix.CALL * 100)}% · F ${Math.round(mix.FOLD * 100)}% · повторный клик = fold`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  if (readOnly) {
                    onSelect?.(code);
                    return;
                  }
                  try {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  } catch {
                    /* older browsers */
                  }
                  painting.current = true;
                  lastHand.current = null;
                  const isFoldBrush =
                    activeBrush.mode === "action" && activeBrush.action === "FOLD";
                  strokeErase.current =
                    !isFoldBrush && handMatchesPaintBrush(mix, activeBrush);
                  onBrushStartRef.current?.();
                  strokeHand(code, true);
                }}
                onPointerMove={(e) => {
                  if (readOnly || !painting.current) return;
                  const next = handUnderPoint(e.clientX, e.clientY, rootRef.current);
                  if (next) strokeHand(next, false);
                }}
              >
                <span className="gto-matrix-code">{code}</span>
                {badge(mix) ? <span className="gto-matrix-pct">{badge(mix)}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
