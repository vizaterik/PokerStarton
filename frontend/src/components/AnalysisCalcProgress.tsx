import { useEffect, useRef, useState } from "react";

type Props = {
  /** Fixed job title, e.g. "Анализ сессии" */
  title: string;
  /** Named steps shown as a checklist (H2N-style) */
  steps?: string[];
  /** Index of the active step */
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

/**
 * Single perceived-progress UI for a full analysis job.
 * Steps only change the label list — one continuous bar.
 */
export default function AnalysisCalcProgress({
  title,
  steps,
  stepIndex = 0,
  compact,
  totalHands = null,
  jobKey = "job",
}: Props) {
  const [progress, setProgress] = useState(4);
  const [hands, setHands] = useState(0);
  const [speed, setSpeed] = useState(0);
  const startRef = useRef(0);
  const total = totalHands != null && totalHands > 0 ? Math.floor(totalHands) : null;

  useEffect(() => {
    startRef.current = performance.now();
    setProgress(4);
    setHands(0);
    setSpeed(0);

    let raf = 0;
    const tick = (now: number) => {
      const t = Math.max(0, (now - startRef.current) / 1000);
      const tau = total ? Math.max(2.2, Math.min(7, total / 140)) : 3.2;
      const p = 1 - Math.exp(-t / tau);
      const progressPct = 4 + 88 * p;

      let handsNow = 0;
      let spd = 0;
      if (total != null) {
        handsNow = Math.min(total, Math.floor(total * p));
        spd = t > 0.2 ? handsNow / t : total / Math.max(tau * 2, 1);
      }

      setProgress(progressPct);
      setHands(handsNow);
      setSpeed(spd);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [jobKey, total]);

  const pct = Math.min(99, Math.round(progress));
  const activeStep = steps?.[Math.min(stepIndex, (steps?.length ?? 1) - 1)] ?? null;

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
          <strong>{title}</strong>
          {activeStep && !steps?.length ? (
            <span className="analysis-calc__phase">{activeStep}</span>
          ) : null}
        </div>
      </div>

      {steps && steps.length > 0 ? (
        <ol className="analysis-calc__steps">
          {steps.map((label, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <li
                key={label}
                className={
                  done
                    ? "is-done"
                    : active
                      ? "is-active"
                      : "is-pending"
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
        <div className="analysis-calc__pct" style={{ left: `${progress}%` }}>
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
