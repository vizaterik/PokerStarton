import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAccount, getMe, isLoggedIn, User } from "../api/client";
import ConfirmDialog from "../components/ConfirmDialog";
import DatabasesPanel from "../components/DatabasesPanel";
// import SubscriptionPanel from "../components/SubscriptionPanel";
import { BRAND } from "../lib/brand";
import { logout } from "../lib/auth";

type ProfileTab = "account" | "databases"; // | "subscription";

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "account", label: "Аккаунт" },
  { id: "databases", label: "Базы" },
  // { id: "subscription", label: "Подписка" },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<ProfileTab>("account");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate("/login", { replace: true });
      return;
    }
    void getMe()
      .then(setUser)
      .catch(() => navigate("/login", { replace: true }));
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
                <span className="profile-field-label">Аккаунт</span>
                <div className="profile-field-value">
                  <strong>
                    {user.created_at
                      ? `с ${new Date(user.created_at).toLocaleDateString("ru-RU")}`
                      : BRAND}
                  </strong>
                </div>
              </div>
            </div>

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
