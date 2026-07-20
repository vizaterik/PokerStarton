import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import AdminFeedPanel from "../components/AdminFeedPanel";
import { getAdminOverview, getMe, type AdminOverview, type TrafficWindow } from "../api/client";

function WindowCard({ title, data }: { title: string; data: TrafficWindow }) {
  return (
    <div className="admin-kpi-card">
      <h3>{title}</h3>
      <dl>
        <div>
          <dt>Просмотры</dt>
          <dd>{data.pageviews.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Уник. посетители</dt>
          <dd>{data.unique_visitors.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Залогиненные</dt>
          <dd>{data.unique_users.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Регистрации</dt>
          <dd>{data.registrations.toLocaleString("ru-RU")}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (!me.is_admin) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        setData(await getAdminOverview());
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить");
          setAllowed(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed === null) {
    return (
      <section className="page">
        <p className="muted">Загрузка админ-панели…</p>
      </section>
    );
  }

  if (!allowed) {
    return <Navigate to="/strategies" replace />;
  }

  return (
    <section className="page admin-page">
      <header className="admin-page-head">
        <div>
          <h1>Админ</h1>
          <p className="lead">Посещаемость и сводка по сайту.</p>
        </div>
        <button
          type="button"
          className="cta-secondary"
          onClick={() => {
            setError(null);
            void getAdminOverview()
              .then(setData)
              .catch((err) =>
                setError(err instanceof Error ? err.message : "Ошибка обновления"),
              );
          }}
        >
          Обновить
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          <div className="admin-kpi-grid">
            <WindowCard title="Сегодня" data={data.today} />
            <WindowCard title="7 дней" data={data.days_7} />
            <WindowCard title="30 дней" data={data.days_30} />
          </div>

          <div className="admin-totals">
            <div>
              <span>Пользователи</span>
              <strong>{data.totals.users.toLocaleString("ru-RU")}</strong>
            </div>
            <div>
              <span>Стратегии</span>
              <strong>{data.totals.strategies.toLocaleString("ru-RU")}</strong>
            </div>
            <div>
              <span>Загрузки</span>
              <strong>{data.totals.hand_uploads.toLocaleString("ru-RU")}</strong>
            </div>
            <div>
              <span>Руки</span>
              <strong>{data.totals.hands.toLocaleString("ru-RU")}</strong>
            </div>
          </div>

          <div className="admin-grid-2">
            <section className="admin-block">
              <h2>Топ страниц (30 дней)</h2>
              {data.top_paths.length === 0 ? (
                <p className="muted">Пока нет данных.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Путь</th>
                      <th>Просмотры</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_paths.map((row) => (
                      <tr key={row.path}>
                        <td>
                          <code>{row.path}</code>
                        </td>
                        <td>{row.count.toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="admin-block">
              <h2>Последние визиты</h2>
              {data.recent.length === 0 ? (
                <p className="muted">Пока нет данных.</p>
              ) : (
                <ul className="admin-recent">
                  {data.recent.map((v, i) => (
                    <li key={`${v.created_at}-${v.visitor_id}-${i}`}>
                      <time dateTime={v.created_at}>
                        {new Date(v.created_at).toLocaleString("ru-RU")}
                      </time>
                      <code>{v.path}</code>
                      <span className="muted">
                        {v.display_name ? v.display_name : "гость"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}

      <AdminFeedPanel />
    </section>
  );
}
