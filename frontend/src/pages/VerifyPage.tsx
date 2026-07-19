import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { afterAuthPath, resendCode, saveTokens, verifyEmail } from "../api/client";

type VerifyState = {
  email?: string;
  message?: string;
  devCode?: string | null;
};

export default function VerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as VerifyState | null) ?? {};
  const [email, setEmail] = useState(state.email ?? "");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(state.devCode ?? null);
  const [info, setInfo] = useState(state.message ?? "Введите код из письма");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => email.trim().length > 3 && code.trim().length >= 4, [email, code]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tokens = await verifyEmail(email.trim(), code.trim());
      saveTokens(tokens);
      navigate(afterAuthPath(tokens));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подтвердить email");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (!email.trim()) {
      setError("Укажите email");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await resendCode(email.trim());
      setInfo(result.message);
      setDevCode(result.dev_code ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="auth-card">
        <h1>Подтверждение</h1>
        <p className="lead muted">{info}</p>
        {devCode && (
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Локальный режим (SMTP не настроен). Код: <strong style={{ color: "var(--accent)" }}>{devCode}</strong>
          </p>
        )}
        <form
          className="panel"
          style={{ maxWidth: "none", padding: 0, border: "none", background: "transparent" }}
          onSubmit={onSubmit}
        >
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label htmlFor="code">Код из письма</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            required
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || !canSubmit}>
            {busy ? "Проверяем…" : "Подтвердить и войти"}
          </button>
          <p className="muted" style={{ marginTop: "1rem" }}>
            Не пришло письмо?{" "}
            <button type="button" className="linkish" onClick={() => void onResend()} disabled={busy}>
              Отправить код снова
            </button>
            {" · "}
            <Link to="/login" style={{ color: "var(--accent)", textDecoration: "underline", fontWeight: 600 }}>
              Ко входу
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}
