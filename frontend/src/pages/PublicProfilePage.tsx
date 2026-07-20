import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicProfile, type PublicProfile } from "../api/client";

function formatHand(hand: string | null | undefined) {
  if (!hand || hand.length < 4) return "Раздача";
  return `${hand.slice(0, 2)} ${hand.slice(2, 4)}`;
}

export default function PublicProfilePage() {
  const { displayName = "" } = useParams<{ displayName: string }>();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const nick = decodeURIComponent(displayName || "").trim();
    if (!nick) {
      setError("Профиль не найден");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getPublicProfile(nick)
      .then((p) => {
        if (!cancelled) setData(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Профиль не найден");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [displayName]);

  if (loading) {
    return (
      <section className="page">
        <p className="muted">Загрузка профиля…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="page">
        <p className="error">{error || "Профиль не найден"}</p>
        <Link to="/feed">← К хитам</Link>
      </section>
    );
  }

  return (
    <section className="page public-profile-page">
      <p className="feed-back">
        <Link to="/feed">← Хиты</Link>
      </p>
      <header className="public-profile-head">
        <h1>{data.display_name}</h1>
        <div className="feed-meta">
          {data.registered_at ? (
            <span>
              Регистрация{" "}
              {new Date(data.registered_at).toLocaleDateString("ru-RU", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
          ) : null}
          <span>Рейтинг {data.rating}</span>
          <span>{data.views_count} просм.</span>
          <span>{data.comments_count} комм.</span>
          <span>♥ {data.likes_received}</span>
          <span>{data.shares_count} раздач</span>
        </div>
      </header>

      <h2 className="public-profile-sub">Раздачи</h2>
      {data.top_hands.length === 0 ? (
        <p className="muted">Пока нет опубликованных раздач.</p>
      ) : (
        <ol className="feed-top-list">
          {data.top_hands.map((h, i) => (
            <li key={h.token}>
              <span className="feed-top-rank">{i + 1}</span>
              <div className="feed-top-body">
                <Link to={h.path} className="feed-top-link">
                  {formatHand(h.hero_hand)}
                  {h.hero_position ? ` · ${h.hero_position}` : ""}
                </Link>
                <div className="feed-meta">
                  {h.stakes_label ? <span>{h.stakes_label}</span> : null}
                  {h.played_at ? (
                    <span>{new Date(h.played_at).toLocaleDateString("ru-RU")}</span>
                  ) : null}
                </div>
              </div>
              <div className="feed-top-stats">
                <span title="Просмотры">{h.views_count ?? 0} просм.</span>
                <span title="Комментарии">{h.comments_count ?? 0} комм.</span>
                <span title="Лайки">♥ {h.likes_count}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
