import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listFeedPosts, type FeedPostListItem } from "../api/client";

export default function FeedPage() {
  const [items, setItems] = useState<FeedPostListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listFeedPosts(40, 0)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить ленту");
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
          <h1>Лента разборов</h1>
          <p className="lead">
            AI находит реальные раздачи (YouTube / HH) и публикует короткий разбор.
          </p>
        </div>
        <span className="feed-count">{total} постов</span>
      </header>

      {loading ? <p className="muted">Загрузка…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="muted">Пока нет опубликованных разборов.</p>
      ) : null}

      <div className="feed-list">
        {items.map((p) => (
          <Link key={p.id} to={`/feed/${p.id}`} className="feed-card">
            <div className="feed-card-top">
              <h2>{p.title}</h2>
              {p.has_replay ? <span className="feed-badge">реплей</span> : null}
            </div>
            <p className="feed-preview">{p.analysis_preview}</p>
            <div className="feed-meta">
              {p.stakes_label ? <span>{p.stakes_label}</span> : null}
              {p.hero_hand ? <span>{p.hero_hand}</span> : null}
              {p.source_channel ? <span>{p.source_channel}</span> : null}
              {p.source_type === "youtube" ? <span>YouTube</span> : null}
              {p.published_at ? (
                <span>
                  {new Date(p.published_at).toLocaleDateString("ru-RU")}
                </span>
              ) : null}
            </div>
            {p.tags.length > 0 ? (
              <div className="feed-tags">
                {p.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
