import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  getAnalysisJob,
  isAnalysisJobBusy,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";
import {
  IconAnalysis,
  IconCareer,
  IconStrategies,
  IconTrainer,
} from "./NavIcons";

type Item = {
  to: string;
  label: string;
  hint: string;
  icon: ReactNode;
  analysis?: boolean;
  match?: (pathname: string) => boolean;
};

const ITEMS: Item[] = [
  {
    to: "/strategies",
    label: "Стратегии",
    hint: "Чарты и дерево",
    icon: <IconStrategies />,
  },
  {
    to: "/trainer",
    label: "Тренажёр",
    hint: "Дриллы по спотам",
    icon: <IconTrainer />,
  },
  {
    to: "/analysis",
    label: "Анализ",
    hint: "HH и сверка с чартами",
    icon: <IconAnalysis />,
    analysis: true,
    match: (p) => p === "/analysis" || p.startsWith("/analysis/") || p === "/upload",
  },
  {
    to: "/career",
    label: "Карьера",
    hint: "Банкролл и прогресс",
    icon: <IconCareer />,
    match: (p) => p === "/career" || p.startsWith("/career/") || p === "/results",
  },
];

function itemMatches(item: Item, pathname: string) {
  if (item.match) return item.match(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function findActiveItem(pathname: string): Item | null {
  return ITEMS.find((item) => itemMatches(item, pathname)) ?? null;
}

/** Dropdown for Strategies / Trainer / Analysis / Career — trigger shows the active section. */
export default function PracticeNavMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  /** Instant label/icon on click, before the route finishes switching. */
  const [picked, setPicked] = useState<Item | null>(null);
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const routeItem = useMemo(
    () => findActiveItem(location.pathname),
    [location.pathname],
  );
  const current = picked ?? routeItem;
  const active = Boolean(current);

  useEffect(() => subscribeAnalysisJob(() => setJob(getAnalysisJob())), []);

  useEffect(() => {
    setOpen(false);
    setPicked(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const busy = isAnalysisJobBusy() || job.status === "done";
  const pct =
    job.status === "done"
      ? 100
      : Math.min(99, Math.max(0, Math.round(job.progress || 0)));

  const triggerLabel = current?.label ?? "Кабинет";
  const triggerIcon = current?.icon ?? <IconStrategies />;
  const showBusyOnTrigger = busy && (!current || current.analysis);

  return (
    <div
      className={`nav-practice${open ? " is-open" : ""}${active ? " is-active" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="nav-practice-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerIcon}
        <span>{triggerLabel}</span>
        {showBusyOnTrigger ? (
          <span
            className={`nav-analysis-pct${job.status === "done" ? " is-done" : ""}${
              job.status === "error" ? " is-error" : ""
            }`}
          >
            {job.status === "error" ? "!" : `${pct}%`}
          </span>
        ) : null}
        <i className="nav-practice-chevron" aria-hidden />
      </button>

      {open ? (
        <div className="nav-practice-menu" id={menuId} role="menu">
          {ITEMS.map((item) => {
            const isCurrent = current?.to === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                role="menuitem"
                className={() =>
                  [
                    "nav-practice-item",
                    isCurrent ? "is-active" : null,
                    item.analysis && busy ? "nav-analysis-busy" : null,
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                onClick={() => {
                  setPicked(item);
                  setOpen(false);
                }}
              >
                {item.icon}
                <span className="nav-practice-item-text">
                  <strong>{item.label}</strong>
                  <em>{item.hint}</em>
                </span>
                {item.analysis && busy ? (
                  <span
                    className={`nav-analysis-pct${job.status === "done" ? " is-done" : ""}${
                      job.status === "error" ? " is-error" : ""
                    }`}
                  >
                    {job.status === "error" ? "!" : `${pct}%`}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
