import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMe,
  isLoggedIn,
  setCachedMe,
  setNickname,
  wakeApi,
} from "../api/client";
import { BRAND } from "../lib/brand";

function isAuthRejected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /не авторизован|unauthorized|could not validate|invalid (access |refresh )?token|credentials/i.test(
    msg,
  );
}

export default function NicknamePage() {
  const navigate = useNavigate();
  const [nickname, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate("/login", { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      await wakeApi(90_000);
      if (cancelled) return;
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me.display_name?.trim()) {
          navigate("/strategies", { replace: true });
        }
      } catch (err) {
        if (cancelled) return;
        if (isAuthRejected(err)) {
          navigate("/login", { replace: true });
          return;
        }
        // Network / cold start — stay on the form, don't bounce.
        setError(
          "Сервер ещё просыпается. Можно ввести ник — при сохранении подождите до минуты.",
        );
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await setNickname(nickname.trim());
      setCachedMe(user);
      navigate("/strategies", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить ник");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="auth-card">
        <h1>Ваш ник</h1>
        <p className="lead muted">
          Придумайте уникальный ник — так вас будут видеть в {BRAND}.
        </p>
        {booting ? <p className="muted">Проверяем сессию…</p> : null}
        <form
          className="panel"
          style={{ maxWidth: "none", padding: 0, border: "none", background: "transparent" }}
          onSubmit={onSubmit}
        >
          <label htmlFor="nickname">Никнейм</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={32}
            placeholder="Например: IceRange"
            required
            autoFocus
            disabled={busy}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || nickname.trim().length < 2}>
            {busy ? "Сохраняем (API может просыпаться)…" : "Продолжить"}
          </button>
        </form>
      </div>
    </section>
  );
}
