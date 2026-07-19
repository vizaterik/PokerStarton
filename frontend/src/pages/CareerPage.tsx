import { useState } from "react";
import BankrollPanel, { type BankrollSection } from "../components/BankrollPanel";
import SessionSchedulePanel from "../components/SessionSchedulePanel";
import ResultsPage from "./ResultsPage";

type CareerTab = "report" | "schedule" | BankrollSection;

const TABS: { id: CareerTab; label: string }[] = [
  { id: "overview", label: "Банкролл" },
  { id: "update", label: "Обновить" },
  { id: "strategy", label: "Стратегия" },
  { id: "schedule", label: "Расписание" },
  { id: "report", label: "Отчёт" },
];

export default function CareerPage() {
  const [tab, setTab] = useState<CareerTab>("overview");

  return (
    <section className="page career-page">
      <header className="career-header">
        <div>
          <h1>Карьера</h1>
          <p className="lead">Банкролл, расписание сессий и отчёт по профиту.</p>
        </div>
      </header>

      <nav className="career-tabs" role="tablist" aria-label="Разделы карьеры">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="career-tab-panel" role="tabpanel">
        {tab === "report" ? (
          <ResultsPage embedded view="full" />
        ) : tab === "schedule" ? (
          <SessionSchedulePanel />
        ) : (
          <BankrollPanel section={tab} />
        )}
      </div>
    </section>
  );
}
