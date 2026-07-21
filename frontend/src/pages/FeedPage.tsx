import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTopHands, type TopHand } from "../api/client";
import EngagementIcons from "../components/EngagementIcons";
import PlayingCard from "../components/PlayingCard";

export default function FeedPage() {
  const [items, setItems] = useState<TopHand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listTopHands(5)
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
          <h1>Топ дня</h1>
          <p className="lead">Лучшие раздачи за день — по просмотрам, лайкам и комментам.</p>
        </div>
      </header>

      {loading ? <p className="muted">Загрузка…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="muted">Пока нет раздач дня.</p>
      ) : null}

      <ol className="hits-list">
        {items.map((h, i) => (
          <li key={h.token} className="hits-card">
            <span className="feed-top-rank">{i + 1}</span>
            <Link to={h.path} className="hits-hand-link" title="Открыть раздачу">
              <span className="hits-cards">
                {h.hero_cards.length >= 2 ? (
                  <>
                    <PlayingCard code={h.hero_cards[0]} size="md" />
                    <PlayingCard code={h.hero_cards[1]} size="md" />
                  </>
                ) : (
                  <span className="muted">?? ??</span>
                )}
              </span>
              <span className="hits-tags">
                {h.pot_tag ? <span className="hits-tag pot">{h.pot_tag}</span> : null}
                {h.matchup ? <span className="hits-tag matchup">{h.matchup}</span> : null}
              </span>
            </Link>
            <div className="hits-side">
              <Link to={h.author_path} className="feed-author-link" title="Профиль">
                {h.author_display_name}
              </Link>
              <EngagementIcons
                className="hits-engagement"
                views={h.views_count}
                comments={h.comments_count}
                likes={h.likes_count}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
