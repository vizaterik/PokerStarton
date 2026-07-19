import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getStrategy, StrategyDetail } from "../api/client";
import GtoTreeEditor from "../components/gto/GtoTreeEditor";

export default function StrategyEditorPage() {
  const { strategyId = "" } = useParams();
  const [strategy, setStrategy] = useState<StrategyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getStrategy(strategyId)
      .then((s) => {
        if (!cancelled) setStrategy(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Стратегия не найдена");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  if (loading) {
    return (
      <section className="page">
        <p className="muted">Загрузка редактора…</p>
      </section>
    );
  }

  if (!strategy) {
    return (
      <section className="page">
        <p className="error">{error ?? "Стратегия не найдена"}</p>
        <Link className="cta" to="/strategies">
          К библиотеке
        </Link>
      </section>
    );
  }

  return (
    <section className="page editor-page gto-editor-page">
      <GtoTreeEditor strategy={strategy} />
    </section>
  );
}
