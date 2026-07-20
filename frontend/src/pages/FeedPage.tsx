import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTopAuthors, type TopAuthor } from "../api/client";

export default function FeedPage() {
  const [items, setItems] = useState<TopAuthor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listTopAuthors(5)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page feed-page">
      <header className="feed-page-head">
        <div>
          <h1>Хиты</h1>
          <p className="lead">Топ‑5 авторов по лайкам на публичных раздачах.</p>
        </div>
      </header>

      {loading ? <p className="muted">Загрузка…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="muted">Пока нет авторов с лайками.</p>
      ) : null}

      <ol className="feed-top-list">
        {items.map((p, i) => (
          <li key={p.path}>
            <span className="feed-top-rank">{i + 1}</span>
            <div className="feed-top-body">
              <Link to={p.path} className="feed-top-link">
                {p.display_name}
              </Link>
              <div className="feed-meta">
                <span>рейтинг {p.rating}</span>
                <span>{p.shares_count} раздач</span>
              </div>
            </div>
            <div className="feed-top-stats">
              <span title="Просмотры раздач">{p.views_count} просм.</span>
              <span title="Комментарии">{p.comments_count} комм.</span>
              <span title="Лайки">♥ {p.likes_count}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
