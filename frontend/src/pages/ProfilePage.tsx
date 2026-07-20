import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  deleteAccount,
  getMe,
  getMyProfileComments,
  getProfileStats,
  isLoggedIn,
  type ProfileComment,
  type ProfileStats,
  type User,
} from "../api/client";
import ConfirmDialog from "../components/ConfirmDialog";
import DatabasesPanel from "../components/DatabasesPanel";
import EngagementIcons, { HeartIcon } from "../components/EngagementIcons";
// import SubscriptionPanel from "../components/SubscriptionPanel";
import { BRAND } from "../lib/brand";
import { logout } from "../lib/auth";

type ProfileTab = "account" | "databases"; // | "subscription";
type StatsPanel = "hands" | "comments" | null;

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "account", label: "Аккаунт" },
  { id: "databases", label: "Базы" },
  // { id: "subscription", label: "Подписка" },
];

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

function formatNet(net: number | null | undefined) {
  if (net == null || !Number.isFinite(net)) return null;
  const sign = net > 0 ? "+" : "";
  return `${sign}${net.toFixed(2)}`;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>("account");
  const [statsPanel, setStatsPanel] = useState<StatsPanel>(null);
  const [comments, setComments] = useState<ProfileComment[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function openComments() {
    if (statsPanel === "comments") {
      setStatsPanel(null);
      return;
    }
    setStatsPanel("comments");
    if (comments != null) return;
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const res = await getMyProfileComments();
      setComments(res.items);
    } catch (err: unknown) {
      setCommentsError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setCommentsLoading(false);
    }
  }

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate("/login", { replace: true });
      return;
    }
    void getMe()
      .then(setUser)
      .catch(() => navigate("/login", { replace: true }));
    void getProfileStats()
      .then(setStats)
      .catch((err: unknown) => {
        setStatsError(err instanceof Error ? err.message : "Не удалось загрузить статистику");
      });
  }, [navigate]);

  async function onDeleteAccount() {
    if (deleteConfirm.trim().toUpperCase() !== "DELETE") {
      setDeleteError("Введи DELETE для подтверждения");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount("DELETE");
      logout();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Не удалось удалить аккаунт");
      setDeleting(false);
    }
  }

  if (!user) {
    return (
      <section className="page">
        <p className="muted">Загрузка профиля…</p>
      </section>
    );
  }

  const registeredAt = stats?.registered_at || user.created_at;

  return (
    <section className="page profile-page">
      <header className="profile-page-head">
        <div>
          <h1>Настройки</h1>
          <p className="lead">Профиль и базы данных в {BRAND}.</p>
        </div>
      </header>

      <nav className="profile-tabs" role="tablist" aria-label="Разделы профиля">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "is-active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="profile-tab-panel" role="tabpanel">
        {tab === "account" ? (
          <div className="profile-card profile-tab-card">
            <h2>Аккаунт</h2>
            <p className="muted profile-tab-lead">Основные данные профиля.</p>

            <div className="profile-fields">
              <div className="profile-field">
                <span className="profile-field-label">Ник</span>
                <div className="profile-field-value">
                  <strong>{user.display_name || "—"}</strong>
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    нельзя изменить
                  </span>
                </div>
              </div>

              <div className="profile-field">
                <span className="profile-field-label">Email</span>
                <div className="profile-field-value">
                  <strong>{user.email}</strong>
                  <span className={`badge ${user.email_verified ? "" : "warn"}`}>
                    {user.email_verified ? "подтверждён" : "не подтверждён"}
                  </span>
                </div>
              </div>

              <div className="profile-field">
                <span className="profile-field-label">Регистрация</span>
                <div className="profile-field-value">
                  <strong>
                    {registeredAt
                      ? new Date(registeredAt).toLocaleDateString("ru-RU", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })
                      : "—"}
                  </strong>
                </div>
              </div>

              <div className="profile-field">
                <span className="profile-field-label">Рейтинг</span>
                <div className="profile-field-value">
                  <strong className="profile-rating">
                    {stats ? stats.rating : "…"}
                  </strong>
                </div>
              </div>

              <div className="profile-field">
                <span className="profile-field-label">Лайки</span>
                <div className="profile-field-value">
                  <strong className="profile-likes-value">
                    <HeartIcon />
                    {stats ? stats.likes_received : "…"}
                  </strong>
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    со всех раздач и комментариев
                  </span>
                </div>
              </div>

              <div className="profile-field">
                <span className="profile-field-label">Комментарии</span>
                <div className="profile-field-value">
                  {stats ? (
                    <button
                      type="button"
                      className={`profile-stat-link${statsPanel === "comments" ? " is-active" : ""}`}
                      onClick={() => void openComments()}
                      disabled={stats.comments_count === 0}
                      title="Все комментарии"
                    >
                      {stats.comments_count}
                    </button>
                  ) : (
                    <strong>…</strong>
                  )}
                </div>
              </div>

              <div className="profile-field">
                <span className="profile-field-label">Раздач опубликовано</span>
                <div className="profile-field-value">
                  {stats ? (
                    <button
                      type="button"
                      className={`profile-stat-link${statsPanel === "hands" ? " is-active" : ""}`}
                      onClick={() =>
                        setStatsPanel(statsPanel === "hands" ? null : "hands")
                      }
                      disabled={stats.shares_count === 0}
                      title="Опубликованные раздачи"
                    >
                      {stats.shares_count}
                    </button>
                  ) : (
                    <strong>…</strong>
                  )}
                </div>
              </div>
            </div>

            {statsError ? <p className="error">{statsError}</p> : null}

            {statsPanel === "hands" ? (
              <div className="profile-top-hands">
                <h3>Опубликованные раздачи</h3>
                {stats && stats.top_hands.length === 0 ? (
                  <p className="muted">Пока нет опубликованных раздач.</p>
                ) : null}
                {stats && stats.top_hands.length > 0 ? (
                  <ol className="profile-top-hands-list">
                    {stats.top_hands.map((h, i) => {
                      const net = formatNet(h.hero_net);
                      return (
                        <li key={h.token}>
                          <span className="profile-top-rank">{i + 1}</span>
                          <div className="profile-top-meta">
                            <Link to={h.path} className="profile-top-link">
                              {formatHandLabel(h.hero_hand)}
                              {h.hero_position ? ` · ${h.hero_position}` : ""}
                            </Link>
                            <span className="muted">
                              {h.played_at
                                ? new Date(h.played_at).toLocaleDateString("ru-RU")
                                : "—"}
                              {net ? ` · ${net}` : ""}
                            </span>
                          </div>
                          <EngagementIcons
                            comments={h.comments_count}
                            likes={h.likes_count}
                          />
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </div>
            ) : null}

            {statsPanel === "comments" ? (
              <div className="profile-top-hands">
                <h3>Комментарии</h3>
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
              </div>
            ) : null}

            <div className="profile-actions">
              <button type="button" className="cta-secondary danger-btn" onClick={logout}>
                Выйти из аккаунта
              </button>
              <button
                type="button"
                className="cta danger-solid"
                onClick={() => {
                  setDeleteConfirm("");
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                Удалить аккаунт
              </button>
            </div>
          </div>
        ) : null}

        {tab === "databases" ? (
          <div className="profile-tab-card-wrap">
            <DatabasesPanel />
          </div>
        ) : null}

        {/* Подписка временно скрыта — лимиты отключены на бэкенде
        {tab === "subscription" ? (
          <div className="profile-tab-card-wrap">
            <SubscriptionPanel />
          </div>
        ) : null}
        */}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        danger
        busy={deleting}
        title="Удалить аккаунт?"
        confirmLabel="Удалить навсегда"
        cancelLabel="Отмена"
        onCancel={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        onConfirm={() => void onDeleteAccount()}
        description={
          <div className="profile-delete-confirm">
            <p>
              Это действие необратимо. Стратегии и профиль исчезнут.
            </p>
            <label>
              Введи <strong>DELETE</strong> для подтверждения
              <input
                value={deleteConfirm}
                onChange={(e) => {
                  setDeleteConfirm(e.target.value);
                  setDeleteError(null);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text") ?? "";
                  setDeleteConfirm(text);
                  setDeleteError(null);
                }}
                placeholder="DELETE"
                autoComplete="off"
                spellCheck={false}
                disabled={deleting}
              />
            </label>
            {deleteError ? <p className="error">{deleteError}</p> : null}
          </div>
        }
      />
    </section>
  );
}
