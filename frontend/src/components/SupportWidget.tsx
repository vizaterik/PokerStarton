import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { getMe, isLoggedIn, submitSupportTicket } from "../api/client";
import { BRAND } from "../lib/brand";
import BrandMark from "./BrandMark";

const TOPICS = [
  "Баг в парсере раздач",
  "Вопрос по чартам/стратегиям",
  // "Проблема с лимитами",
  "Другое",
] as const;

type View = "home" | "form" | "success";

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("home");
  const [nick, setNick] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open || !isLoggedIn()) return;
    void getMe()
      .then((me) => {
        if (me.display_name) setNick(me.display_name);
        if (me.email) setEmail(me.email);
      })
      .catch(() => {
        /* guest / session expired — leave fields empty */
      });
  }, [open]);

  function resetForm() {
    setNick("");
    setEmail("");
    setTopic(TOPICS[0]);
    setMessage("");
    setError(null);
  }

  function closePanel() {
    setOpen(false);
    setView("home");
    setError(null);
    setBusy(false);
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitSupportTicket({
        site_nick: nick.trim(),
        email: email.trim(),
        topic,
        message: message.trim(),
      });
      setView("success");
      resetForm();
      closeTimer.current = window.setTimeout(() => {
        closePanel();
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить запрос");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="support-widget">
      {open ? (
        <div
          className="support-panel"
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-label="Поддержка"
        >
          <header className="support-panel-head">
            <div className="support-panel-brand">
              <BrandMark className="support-mark" />
              <div>
                <strong>{BRAND}</strong>
                <em>Служба поддержки</em>
              </div>
            </div>
            <button type="button" className="support-close" onClick={closePanel} aria-label="Закрыть">
              ✕
            </button>
          </header>

          <div className="support-panel-body">
            {view === "home" ? (
              <>
                <div className="support-live">
                  <div className="support-live-row">
                    <span className="support-live-title">Живой чат</span>
                    <span className="support-dot" aria-hidden="true" />
                    <span className="support-live-status">Офлайн (будет доступен позже)</span>
                  </div>
                  <p className="support-live-hint">
                    Пока напишите нам через форму — ответим на email.
                  </p>
                </div>
                <button type="button" className="support-primary" onClick={() => setView("form")}>
                  Написать нам
                </button>
              </>
            ) : null}

            {view === "form" ? (
              <form className="support-form" onSubmit={(e) => void onSubmit(e)}>
                <button
                  type="button"
                  className="support-back"
                  onClick={() => {
                    setView("home");
                    setError(null);
                  }}
                >
                  ← Назад
                </button>
                <label>
                  <span>Ник на сайте</span>
                  <input
                    value={nick}
                    onChange={(e) => setNick(e.target.value)}
                    placeholder="Ваш ник в PokerStraton"
                    maxLength={64}
                    required
                    autoComplete="nickname"
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email для ответа"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  <span>Тема обращения</span>
                  <select value={topic} onChange={(e) => setTopic(e.target.value)} required>
                    {TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Описание</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Опишите вашу проблему или прикрепите текст раздачи..."
                    rows={4}
                    required
                    minLength={3}
                    maxLength={8000}
                  />
                </label>
                {error ? <p className="error support-error">{error}</p> : null}
                <button type="submit" className="support-primary" disabled={busy}>
                  {busy ? "Отправка…" : "Отправить запрос"}
                </button>
              </form>
            ) : null}

            {view === "success" ? (
              <div className="support-success">
                <p>
                  Спасибо! Ваш запрос зарегистрирован. Наш специалист свяжется с вами по Email в
                  течение 15 минут
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={`support-fab${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open) closePanel();
          else {
            setOpen(true);
            setView("home");
          }
        }}
      >
        <SupportIcon />
        <span>Поддержка</span>
      </button>
    </div>
  );
}

function SupportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H12l-3.8 3.2c-.55.46-1.2.08-1.2-.65V16H7.5A2.5 2.5 0 0 1 5 13.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
