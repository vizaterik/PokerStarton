import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getAnalysisJob,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";

type Props = {
  uploadBlock?: ReactNode;
  pendingHands?: number | null;
  /** Slim banner above existing results (does not replace the report). */
  compact?: boolean;
};

const STEPS = [
  "Разбор истории",
  "HUD и график",
  "Проверяем стратегию",
  "Сохранение",
] as const;

/** Ordered steps from a single % — never jumps backward. */
function stepFromPct(pct: number): number {
  if (pct >= 78) return 3;
  if (pct >= 52) return 2;
  if (pct >= 28) return 1;
  return 0;
}

function titleFor(job: AnalysisJobState): string {
  if (job.status === "uploading") return "Загрузка сессии";
  if (job.status === "done") return "Анализ завершён";
  if (job.status === "error") return "Ошибка анализа";
  return "Разбор сессии";
}

/** In-page status while analysis runs — one continuous % bar, ordered steps. */
export default function AnalysisBgWait({
  uploadBlock,
  pendingHands,
  compact = false,
}: Props) {
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const [displayPct, setDisplayPct] = useState(() =>
    Math.min(99, Math.max(0, getAnalysisJob().progress || 0)),
  );
  const [stepIndex, setStepIndex] = useState(() =>
    stepFromPct(getAnalysisJob().progress || 0),
  );
  const displayRef = useRef(displayPct);
  const maxStepRef = useRef(stepIndex);
  const jobGenRef = useRef(0);

  useEffect(() => {
    let prevStatus = getAnalysisJob().status;
    return subscribeAnalysisJob(() => {
      const next = getAnalysisJob();
      // New upload → reset bar once (never mid-job).
      if (
        (next.status === "uploading" || next.status === "running") &&
        (prevStatus === "idle" || prevStatus === "done" || prevStatus === "error")
      ) {
        jobGenRef.current += 1;
        displayRef.current = Math.max(0, next.progress || 2);
        maxStepRef.current = 0;
        setDisplayPct(displayRef.current);
        setStepIndex(0);
      }
      prevStatus = next.status;
      setJob(next);
    });
  }, []);

  // Smooth chase of job.progress — monotonic while busy, no integer jumps.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const busy = job.status === "uploading" || job.status === "running";
      const target =
        job.status === "done"
          ? 100
          : job.status === "error"
            ? displayRef.current
            : Math.min(99, Math.max(0, job.progress || 0));

      let cur = displayRef.current;
      if (busy || job.status === "done") {
        const goal = Math.max(cur, target);
        const delta = goal - cur;
        cur = delta < 0.08 ? goal : cur + delta * 0.14;
      }
      displayRef.current = cur;
      setDisplayPct(cur);

      const nextStep = Math.max(maxStepRef.current, stepFromPct(cur));
      if (nextStep !== maxStepRef.current) {
        maxStepRef.current = nextStep;
        setStepIndex(nextStep);
      } else if (job.status === "done") {
        maxStepRef.current = STEPS.length;
        setStepIndex(STEPS.length);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [job.progress, job.status]);

  const progressHands = pendingHands ?? job.hands;
  const pct = Math.min(100, Math.round(displayPct));
  const barPct = Math.min(100, displayPct);
  const title = titleFor(job);
  const busy = job.status === "uploading" || job.status === "running";
  const activeLabel =
    job.error ||
    (job.status === "done"
      ? "Готово"
      : STEPS[Math.min(stepIndex, STEPS.length - 1)]);

  return (
    <div
      className={
        compact
          ? "analysis-bg-wait-banner"
          : "analysis-panel"
      }
    >
      {uploadBlock}
      <div
        className={`analysis-calc analysis-bg-wait${compact ? " analysis-bg-wait--compact" : ""}${busy ? "" : " is-idle"}`}
        role="status"
        aria-live="polite"
        aria-busy={busy}
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
            <span className="analysis-calc__phase">{activeLabel}</span>
          </div>
        </div>

        <ol className="analysis-calc__steps">
          {STEPS.map((label, i) => {
            const done = i < stepIndex || job.status === "done";
            const active = busy && i === stepIndex;
            return (
              <li
                key={label}
                className={done ? "is-done" : active ? "is-active" : "is-pending"}
              >
                <span className="analysis-calc__step-mark" aria-hidden />
                <span>{label}</span>
              </li>
            );
          })}
        </ol>

        <div className="analysis-calc__bar">
          <div
            className="analysis-calc__pct"
            style={{ left: `${Math.min(99.5, Math.max(2, barPct))}%` }}
          >
            {pct}%
          </div>
          <div className="analysis-calc__track">
            <div
              className="analysis-calc__fill"
              style={{ width: `${barPct}%` }}
            />
            {busy ? <div className="analysis-calc__shimmer" aria-hidden /> : null}
          </div>
        </div>

        <div className="analysis-calc__meta">
          {progressHands != null && progressHands > 0 ? (
            <span>
              <em>{progressHands.toLocaleString("ru-RU")}</em> раздач
            </span>
          ) : (
            <span className="muted">{activeLabel}</span>
          )}
          {job.error ? <span className="error">{job.error}</span> : null}
        </div>
      </div>
    </div>
  );
}
