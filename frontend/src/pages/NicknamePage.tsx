import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, isLoggedIn, setNickname } from "../api/client";
import { BRAND } from "../lib/brand";

export default function NicknamePage() {
  const navigate = useNavigate();
  const [nickname, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate("/login", { replace: true });
      return;
    }
    void getMe()
      .then((me) => {
        if (me.display_name) navigate("/strategies", { replace: true });
      })
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setNickname(nickname.trim());
      navigate("/strategies");
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
        <p className="lead muted">Придумайте уникальный ник — так вас будут видеть в {BRAND}.</p>
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
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || nickname.trim().length < 2}>
            {busy ? "Сохраняем…" : "Продолжить"}
          </button>
        </form>
      </div>
    </section>
  );
}
