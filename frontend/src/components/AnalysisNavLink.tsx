import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  getAnalysisJob,
  isAnalysisJobBusy,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";
import { IconAnalysis } from "./NavIcons";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "is-active" : undefined;
}

/** Topbar «Анализ» with live % while upload/analysis runs in the background. */
export default function AnalysisNavLink() {
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());

  useEffect(() => subscribeAnalysisJob(() => setJob(getAnalysisJob())), []);

  const busy = isAnalysisJobBusy() || job.status === "done";
  const pct =
    job.status === "done"
      ? 100
      : Math.min(99, Math.max(0, Math.round(job.progress || 0)));

  return (
    <NavLink
      to="/analysis"
      className={(args) => {
        const base = navClass(args);
        return [base, busy ? "nav-analysis-busy" : null].filter(Boolean).join(" ") || undefined;
      }}
      title={
        busy
          ? job.message ||
            (job.status === "done"
              ? "Анализ готов"
              : job.status === "uploading"
                ? "Импорт истории"
                : "Идёт анализ")
          : undefined
      }
    >
      <IconAnalysis />
      <span className="nav-analysis-label">Анализ</span>
      {busy ? (
        <span
          className={`nav-analysis-pct${job.status === "done" ? " is-done" : ""}${job.status === "error" ? " is-error" : ""}`}
          aria-live="polite"
        >
          {job.status === "error" ? "!" : `${pct}%`}
        </span>
      ) : null}
    </NavLink>
  );
}
