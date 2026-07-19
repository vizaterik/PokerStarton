import { useEffect, useState, type ReactNode } from "react";
import {
  getAnalysisJob,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";

type Props = {
  uploadBlock?: ReactNode;
  pendingHands?: number | null;
};

const STEPS = [
  "Разбор истории",
  "HUD и график",
  "Проверяем стратегию",
  "Загрузка в базу",
] as const;

function stepIndexFor(job: AnalysisJobState): number {
  if (job.status === "done") return STEPS.length;
  if (job.status === "error") return 0;
  const msg = (job.message || "").toLowerCase();
  const pct = job.progress || 0;
  if (
    pct >= 72 ||
    msg.includes("баз") ||
    msg.includes("сервер") ||
    msg.includes("отправляем") ||
    msg.includes("мб") ||
    msg.includes("кб")
  ) {
    return 3;
  }
  if (
    msg.includes("стратег") ||
    msg.includes("проверяем") ||
    msg.includes("разбор сессии") ||
    msg.includes("отклон") ||
    msg.includes("сверк") ||
    pct >= 68
  ) {
    return 2;
  }
  if (msg.includes("hud") || msg.includes("график") || pct >= 55 || (job.step ?? 0) >= 1) {
    return 1;
  }
  if (job.status === "uploading" || job.status === "running") return 0;
  return 0;
}

function titleFor(job: AnalysisJobState): string {
  if (job.status === "uploading") return "Загрузка сессии";
  if (job.status === "done") return "Анализ завершён";
  if (job.status === "error") return "Ошибка анализа";
  return "Разбор сессии";
}

/** In-page status while analysis runs — live % and current stage. */
export default function AnalysisBgWait({ uploadBlock, pendingHands }: Props) {
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());

  useEffect(() => subscribeAnalysisJob(() => setJob(getAnalysisJob())), []);

  const progressHands = pendingHands ?? job.hands;
  const rawPct = Math.min(100, Math.max(0, job.progress || 0));
  const pct = Math.min(99, Math.round(rawPct));
  const stepIndex = stepIndexFor(job);
  const title = titleFor(job);
  const busy = job.status === "uploading" || job.status === "running";

  return (
    <div className="analysis-panel">
      {uploadBlock}
      <div
        className={`analysis-calc analysis-bg-wait${busy ? "" : " is-idle"}`}
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
            <span className="analysis-calc__phase">
              {job.error || job.message || "Обработка…"}
              {progressHands
                ? ` · ${progressHands.toLocaleString("ru-RU")} рук`
                : ""}
            </span>
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
          <div className="analysis-calc__pct" style={{ left: `${Math.min(99, rawPct)}%` }}>
            {pct}%
          </div>
          <div className="analysis-calc__track">
            <div
              className="analysis-calc__fill"
              style={{
                width: `${Math.min(100, rawPct)}%`,
                transition: "width 0.12s linear",
              }}
            />
            {busy ? <div className="analysis-calc__shimmer" aria-hidden /> : null}
          </div>
        </div>

        <div className="analysis-calc__meta">
          {progressHands != null && progressHands > 0 ? (
            <span>
              <em>{progressHands.toLocaleString("ru-RU")}</em> раздач в работе
            </span>
          ) : (
            <span className="muted">Можно переключать разделы — разбор продолжится</span>
          )}
          {job.error ? <span className="error">{job.error}</span> : null}
        </div>
      </div>
    </div>
  );
}
