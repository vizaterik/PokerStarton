import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";
import { BRAND } from "../lib/brand";
import {
  getAnalysisJob,
  resetAnalysisJob,
  subscribeAnalysisJob,
} from "../lib/analysisJob";

type Props = {
  /** Main status line under the brand */
  message?: string;
  /** Optional 0–100 progress */
  progress?: number | null;
  /** Hands in the job, if known */
  hands?: number | null;
  /** Fill the analysis results area (default) */
  full?: boolean;
  /** Error styling for the message line */
  error?: boolean;
  /** Dismiss control under an error */
  onDismiss?: () => void;
};

/**
 * Full-area poker-style boot screen (GTO Wizard vibe):
 * brand mark, felt glow, progress ring.
 */
export default function AnalysisBootScreen({
  message = "Анализ рук…",
  progress = null,
  hands = null,
  full = true,
  error = false,
  onDismiss,
}: Props) {
  const pct =
    progress != null && Number.isFinite(progress)
      ? Math.min(100, Math.max(0, Math.round(progress)))
      : null;
  const ring = pct != null ? pct : error ? 0 : 18;
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (ring / 100) * c;

  return (
    <div
      className={`analysis-boot${full ? " analysis-boot--full" : ""}${error ? " analysis-boot--error" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!error}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      <div className="analysis-boot__felt" aria-hidden />
      <div className="analysis-boot__suits" aria-hidden>
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
      </div>

      <div className="analysis-boot__core">
        <div className="analysis-boot__ring-wrap">
          <svg className="analysis-boot__ring" viewBox="0 0 100 100" aria-hidden>
            <circle className="analysis-boot__ring-track" cx="50" cy="50" r={r} />
            <circle
              className="analysis-boot__ring-fill"
              cx="50"
              cy="50"
              r={r}
              style={{
                strokeDasharray: `${dash} ${c}`,
              }}
            />
          </svg>
          <div className="analysis-boot__mark">
            <BrandMark className="analysis-boot__brand-mark" />
          </div>
        </div>

        <strong className="analysis-boot__name">{BRAND}</strong>
        <p className={`analysis-boot__msg${error ? " is-error" : ""}`}>{message}</p>
        {error ? null : pct != null ? (
          <p className="analysis-boot__pct">{pct}%</p>
        ) : (
          <div className="analysis-boot__dots" aria-hidden>
            <i />
            <i />
            <i />
          </div>
        )}
        {!error && hands != null && hands > 0 ? (
          <p className="analysis-boot__hands">
            {hands.toLocaleString("ru-RU")} раздач
          </p>
        ) : null}
        {error && onDismiss ? (
          <button type="button" className="analysis-boot__dismiss" onClick={onDismiss}>
            Понятно
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Live job-driven boot (upload / running analysis / import error). */
export function AnalysisJobBoot({
  pendingHands,
}: {
  pendingHands?: number | null;
}) {
  const [job, setJob] = useState(() => getAnalysisJob());
  useEffect(() => subscribeAnalysisJob(() => setJob(getAnalysisJob())), []);

  const busy = job.status === "uploading" || job.status === "running";
  const isError = job.status === "error" && Boolean(job.error);

  // After «Понятно» job becomes idle — remove the overlay, don't flash «Готово».
  if (job.status === "idle") return null;

  const message =
    job.error ||
    (job.status === "uploading"
      ? "Загрузка рук…"
      : busy
        ? "Анализ рук…"
        : job.status === "done"
          ? "Готово"
          : "Анализ рук…");

  return (
    <AnalysisBootScreen
      message={message}
      progress={busy || job.status === "done" ? job.progress : null}
      hands={pendingHands ?? job.hands}
      error={isError}
      onDismiss={
        isError
          ? () => {
              resetAnalysisJob();
            }
          : undefined
      }
    />
  );
}
