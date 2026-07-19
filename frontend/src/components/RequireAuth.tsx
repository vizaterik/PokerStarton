import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import {
  clearCachedMe,
  clearTokens,
  getCachedMe,
  getMe,
  isLoggedIn,
  setCachedMe,
  wakeApi,
} from "../api/client";

type Gate = "loading" | "login" | "nickname" | "ok" | "retry";

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
      clearCachedMe();
      setGate("login");
      return;
    }

    const cached = getCachedMe();
    if (cached) {
      const needsNick = !cached.display_name?.trim();
      const onNickPage = location.pathname === "/nickname";
      if (needsNick && !onNickPage) {
        setGate("nickname");
        return;
      }
      if (!needsNick && onNickPage) {
        setGate("ok");
        return;
      }
      setGate("ok");
      return;
    }

    let cancelled = false;
    setGate("loading");
    // Free Render cold start — don't flash "retry" after 8s.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setGate("retry");
    }, 60_000);

    void (async () => {
      await wakeApi(90_000);
      if (cancelled) return;
      try {
        const me = await getMe();
        if (cancelled) return;
        window.clearTimeout(timer);
        setCachedMe(me);
        const needsNick = !me.display_name?.trim();
        const onNickPage = location.pathname === "/nickname";
        if (needsNick && !onNickPage) {
          setGate("nickname");
          return;
        }
        setGate("ok");
      } catch (err) {
        window.clearTimeout(timer);
        if (cancelled) return;
        if (isAuthRejected(err)) {
          clearCachedMe();
          clearTokens();
          setGate("login");
          return;
        }
        const soft = getCachedMe();
        if (soft) {
          setGate("ok");
          return;
        }
        setGate("retry");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [location.pathname, retryTick]);

  if (gate === "loading") {
    return (
      <section className="page">
        <p className="muted">
          Проверка входа… На Free Render API может просыпаться до минуты — подождите.
        </p>
      </section>
    );
  }

  if (gate === "retry") {
    return (
      <section className="page">
        <p className="muted">
          Сервер ещё просыпается или не отвечает. Сессия сохранена — подождите и нажмите
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
