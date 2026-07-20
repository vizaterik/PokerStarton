import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicProfile, type PublicProfile } from "../api/client";

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
            <span>♥ {data.likes_received}</span>
          </div>
        </div>
      </header>
    </section>
  );
}
