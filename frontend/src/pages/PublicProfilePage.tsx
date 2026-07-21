import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getPublicProfile,
  getPublicProfileComments,
  type ProfileComment,
  type PublicProfile,
} from "../api/client";
import EngagementIcons, { HeartIcon } from "../components/EngagementIcons";

type Panel = "hands" | "comments" | null;

const STREET_RU: Record<string, string> = {
  preflop: "Префлоп",
  flop: "Флоп",
  turn: "Тёрн",
  river: "Ривер",
};

function formatHandLabel(hand: string | null | undefined) {
  if (!hand || hand.length < 4) return "Раздача";
  return `${hand.slice(0, 2)} ${hand.slice(2, 4)}`;
}

export default function PublicProfilePage() {
  const { displayName = "" } = useParams<{ displayName: string }>();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [comments, setComments] = useState<ProfileComment[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);

  useEffect(() => {
    const nick = decodeURIComponent(displayName || "").trim();
    if (!nick) {
      setError("Профиль не найден");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPanel(null);
    setComments(null);
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

  async function openComments() {
    if (panel === "comments") {
      setPanel(null);
      return;
    }
    setPanel("comments");
    if (comments != null || !data) return;
    const nick = data.display_name;
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const res = await getPublicProfileComments(nick);
      setComments(res.items);
    } catch (err: unknown) {
      setCommentsError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setCommentsLoading(false);
    }
  }

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
        <Link to="/feed">← К топу дня</Link>
      </section>
    );
  }

  return (
    <section className="page public-profile-page">
      <p className="feed-back">
        <Link to="/feed">← Топ дня</Link>
      </p>
      <header className="public-profile-head">
        <h1>{data.display_name}</h1>
        <div className="public-profile-stats">
          {data.registered_at ? (
            <div>
              <span className="public-profile-stat-label">Регистрация</span>
              <span>
                {new Date(data.registered_at).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          ) : null}
          <div>
            <span className="public-profile-stat-label">Рейтинг</span>
            <span>{data.rating}</span>
          </div>
          <div>
            <span className="public-profile-stat-label">Лайки</span>
            <span className="profile-likes-value">
              <HeartIcon />
              {data.likes_received}
            </span>
          </div>
          <div>
            <span className="public-profile-stat-label">Комментарии</span>
            <button
              type="button"
              className={`profile-stat-link${panel === "comments" ? " is-active" : ""}`}
              onClick={() => void openComments()}
              disabled={data.comments_count === 0}
              title="Все комментарии"
            >
              {data.comments_count}
            </button>
          </div>
          <div>
            <span className="public-profile-stat-label">Раздач опубликовано</span>
            <button
              type="button"
              className={`profile-stat-link${panel === "hands" ? " is-active" : ""}`}
              onClick={() => setPanel(panel === "hands" ? null : "hands")}
              disabled={data.shares_count === 0}
              title="Опубликованные раздачи"
            >
              {data.shares_count}
            </button>
          </div>
        </div>
      </header>

      {panel === "hands" ? (
        <>
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
                      {formatHandLabel(h.hero_hand)}
                      {h.hero_position ? ` · ${h.hero_position}` : ""}
                    </Link>
                    <div className="feed-meta">
                      {h.played_at ? (
                        <span>{new Date(h.played_at).toLocaleDateString("ru-RU")}</span>
                      ) : null}
                    </div>
                  </div>
                  <EngagementIcons comments={h.comments_count} likes={h.likes_count} />
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}

      {panel === "comments" ? (
        <>
          <h2 className="public-profile-sub">Комментарии</h2>
          {commentsLoading ? <p className="muted">Загрузка…</p> : null}
          {commentsError ? <p className="error">{commentsError}</p> : null}
          {!commentsLoading && comments && comments.length === 0 ? (
            <p className="muted">Пока нет комментариев.</p>
          ) : null}
          {comments && comments.length > 0 ? (
            <ul className="profile-comments-list">
              {comments.map((c) => (
                <li key={c.id} className="profile-comment-card">
                  <div className="profile-comment-head">
                    <strong>{c.author_name}</strong>
                    <span className="muted">
                      {STREET_RU[c.street] || c.street}
                      {c.created_at
                        ? ` · ${new Date(c.created_at).toLocaleDateString("ru-RU")}`
                        : ""}
                    </span>
                  </div>
                  <p className="profile-comment-body">{c.body}</p>
                  <Link to={c.hand_path} className="profile-comment-hand">
                    → {formatHandLabel(c.hero_hand)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
