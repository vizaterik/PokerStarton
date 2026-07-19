import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { clearTokens, getMe, isLoggedIn, type User } from "../api/client";

type Gate = "loading" | "login" | "nickname" | "ok" | "retry";

const AUTH_CACHE_MS = 90_000;
let cachedMe: User | null = null;
let cachedAt = 0;

function isAuthRejected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /не авторизован|unauthorized|could not validate|invalid (access |refresh )?token|credentials/i.test(
    msg,
  );
}

export default function RequireAuth() {
  const location = useLocation();
  const [gate, setGate] = useState<Gate>("loading");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!isLoggedIn()) {
      cachedMe = null;
      cachedAt = 0;
      setGate("login");
      return;
    }

    const now = Date.now();
    // Avoid /auth/me on every tab switch while a long upload holds the server.
    if (cachedMe && now - cachedAt < AUTH_CACHE_MS) {
      const needsNick = !cachedMe.display_name?.trim();
      const onNickPage = location.pathname === "/nickname";
      if (needsNick && !onNickPage) {
        setGate("nickname");
        return;
      }
      setGate("ok");
      return;
    }

    let cancelled = false;
    setGate("loading");
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setGate("retry");
    }, 8000);
    void getMe()
      .then((me) => {
        if (cancelled) return;
        window.clearTimeout(timer);
        cachedMe = me;
        cachedAt = Date.now();
        const needsNick = !me.display_name?.trim();
        const onNickPage = location.pathname === "/nickname";
        if (needsNick && !onNickPage) {
          setGate("nickname");
          return;
        }
        setGate("ok");
      })
      .catch((err) => {
        window.clearTimeout(timer);
        if (cancelled) return;
        if (isAuthRejected(err)) {
          cachedMe = null;
          cachedAt = 0;
          clearTokens();
          setGate("login");
          return;
        }
        // Network / busy server — keep session; if we had a recent user, stay in.
        if (cachedMe) {
          setGate("ok");
          return;
        }
        setGate("retry");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [location.pathname, retryTick]);

  if (gate === "loading") {
    return (
      <section className="page">
        <p className="muted">Проверка входа…</p>
      </section>
    );
  }

  if (gate === "retry") {
    return (
      <section className="page">
        <p className="muted">
          Сервер занят разбором раздач или не отвечает. Сессия сохранена — подождите и нажмите
          «Повторить».
        </p>
        <p style={{ marginTop: "0.75rem" }}>
          <button type="button" className="upload-submit" onClick={() => setRetryTick((n) => n + 1)}>
            Повторить
          </button>
        </p>
      </section>
    );
  }

  if (gate === "login") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (gate === "nickname") {
    return <Navigate to="/nickname" replace />;
  }

  return <Outlet />;
}
