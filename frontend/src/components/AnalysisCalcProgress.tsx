import { useEffect, useRef, useState } from "react";

type Props = {
  /** Fixed job title, e.g. "Анализ сессии" */
  title: string;
  /** Named steps shown as a checklist (H2N-style) */
  steps?: string[];
  /** Index of the active step (optional — derived from % when omitted) */
  stepIndex?: number;
  compact?: boolean;
  /**
   * Real hand count for this job. Counter never exceeds it.
   * If omitted, hand totals are hidden (no fake 3000+).
   */
  totalHands?: number | null;
  /**
   * Change to restart the bar (new upload / refresh).
   * Phase/step changes must NOT reset progress.
   */
  jobKey?: string | number;
};

function stepFromPct(pct: number, count: number): number {
  if (count <= 1) return 0;
  const band = 90 / count;
  return Math.min(count - 1, Math.floor(Math.max(0, pct - 4) / band));
}

/**
 * Single perceived-progress UI for a full analysis job.
 * One continuous bar; steps advance only forward from %.
 */
export default function AnalysisCalcProgress({
  title,
  steps,
  stepIndex,
  compact,
  totalHands = null,
  jobKey = "job",
}: Props) {
  const [progress, setProgress] = useState(4);
  const [hands, setHands] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [derivedStep, setDerivedStep] = useState(0);
  const startRef = useRef(0);
  const progressRef = useRef(4);
  const maxStepRef = useRef(0);
  const total = totalHands != null && totalHands > 0 ? Math.floor(totalHands) : null;

  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    startRef.current = performance.now();
    progressRef.current = 4;
    maxStepRef.current = 0;
    setProgress(4);
    setHands(0);
    setSpeed(0);
    setDerivedStep(0);

    let raf = 0;
    const tick = (now: number) => {
      const t = Math.max(0, (now - startRef.current) / 1000);
      const tau = total ? Math.max(2.5, Math.min(8, total / 130)) : 3.5;
      const target = 4 + 88 * (1 - Math.exp(-t / tau));
      // Smooth chase — never decrease.
      let cur = progressRef.current;
      const goal = Math.max(cur, target);
      cur = goal - cur < 0.06 ? goal : cur + (goal - cur) * 0.12;
      progressRef.current = cur;

      let handsNow = 0;
      let spd = 0;
      if (total != null) {
        const p = Math.max(0, (cur - 4) / 88);
        handsNow = Math.min(total, Math.floor(total * p));
        spd = t > 0.2 ? handsNow / t : total / Math.max(tau * 2, 1);
      }

      setProgress(cur);
      setHands(handsNow);
      setSpeed(spd);

      const stepList = stepsRef.current;
      if (stepList && stepList.length > 0) {
        const fromPct = stepFromPct(cur, stepList.length);
        const fromProp =
          stepIndexRef.current != null
            ? Math.min(stepIndexRef.current, stepList.length - 1)
            : fromPct;
        const next = Math.max(maxStepRef.current, fromPct, fromProp);
        if (next !== maxStepRef.current) {
          maxStepRef.current = next;
          setDerivedStep(next);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Only restart bar on new job / hand total — not on step label changes.
  }, [jobKey, total]);

  const pct = Math.min(99, Math.round(progress));
  const activeStepIdx =
    steps && steps.length > 0
      ? Math.min(derivedStep, steps.length - 1)
      : 0;
  const activeStep = steps?.[activeStepIdx] ?? null;

  return (
    <div
      className={`analysis-calc${compact ? " analysis-calc--compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="analysis-calc__head">
        <div className="analysis-calc__pulse" aria-hidden />
        <div className="analysis-calc__titles">
          <strong>
            {title}
            {pct > 0 ? ` · ${pct}%` : ""}
          </strong>
          {activeStep ? (
            <span className="analysis-calc__phase">{activeStep}</span>
          ) : null}
        </div>
      </div>

      {steps && steps.length > 0 ? (
        <ol className="analysis-calc__steps">
          {steps.map((label, i) => {
            const done = i < activeStepIdx;
            const active = i === activeStepIdx;
            return (
              <li
                key={label}
                className={
                  done ? "is-done" : active ? "is-active" : "is-pending"
                }
              >
                <span className="analysis-calc__step-mark" aria-hidden />
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="analysis-calc__bar">
        <div
          className="analysis-calc__pct"
          style={{ left: `${Math.min(99.5, Math.max(2, progress))}%` }}
        >
          {pct}%
        </div>
        <div className="analysis-calc__track">
          <div className="analysis-calc__fill" style={{ width: `${progress}%` }} />
          <div className="analysis-calc__shimmer" aria-hidden />
        </div>
      </div>

      <div className="analysis-calc__meta">
        {total != null ? (
          <>
            <span>
              <em>
                {hands.toLocaleString("ru-RU")}
                {" / "}
                {total.toLocaleString("ru-RU")}
              </em>{" "}
              раздач
            </span>
            <span className="analysis-calc__speed">
              <em>{Math.max(0, Math.round(speed)).toLocaleString("ru-RU")}</em> разд/с
            </span>
          </>
        ) : (
          <span className="muted">{activeStep ?? "Обработка…"}</span>
        )}
      </div>
    </div>
  );
}
