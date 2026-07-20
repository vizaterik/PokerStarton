import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTopLikedHands, type TopLikedHand } from "../api/client";

function formatHand(hand: string | null | undefined) {
  if (!hand || hand.length < 4) return "Раздача";
  return `${hand.slice(0, 2)} ${hand.slice(2, 4)}`;
}

function formatNet(net: number | null | undefined) {
  if (net == null || !Number.isFinite(net)) return null;
  const sign = net > 0 ? "+" : "";
  return `${sign}${net.toFixed(2)}`;
}

export default function FeedPage() {
  const [items, setItems] = useState<TopLikedHand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listTopLikedHands(5)
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
          <p className="lead">Топ‑5 публичных раздач по лайкам.</p>
        </div>
      </header>

      {loading ? <p className="muted">Загрузка…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="muted">Пока нет лайкнутых публичных раздач.</p>
      ) : null}

      <ol className="feed-top-list">
        {items.map((p, i) => {
          const net = formatNet(p.hero_net);
          return (
            <li key={p.token}>
              <span className="feed-top-rank">{i + 1}</span>
              <div className="feed-top-body">
                <Link to={p.path} className="feed-top-link">
                  {formatHand(p.hero_hand)}
                  {p.hero_position ? ` · ${p.hero_position}` : ""}
                </Link>
                <div className="feed-meta">
                  {p.author_name && p.author_path ? (
                    <Link to={p.author_path} className="feed-author-link">
                      {p.author_name}
                    </Link>
                  ) : p.author_name ? (
                    <span>{p.author_name}</span>
                  ) : null}
                  {p.stakes_label ? <span>{p.stakes_label}</span> : null}
                  {p.played_at ? (
                    <span>{new Date(p.played_at).toLocaleDateString("ru-RU")}</span>
                  ) : null}
                  {net ? <span>{net}</span> : null}
                </div>
              </div>
              <div className="feed-top-stats">
                <span title="Просмотры">{p.views_count ?? 0} просм.</span>
                <span title="Лайки">♥ {p.likes_count}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
