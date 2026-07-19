import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { afterAuthPath, login, register, saveTokens, TokenResponse } from "../api/client";
import TermsModal from "../components/TermsModal";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { from?: string; mode?: "login" | "register" } | null;
  const from = locState?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">(
    locState?.mode === "register" ? "register" : "login",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (locState?.mode === "register" || locState?.mode === "login") {
      setMode(locState.mode);
    }
  }, [locState?.mode]);

  const finishAuth = useCallback(
    (tokens: TokenResponse) => {
      if (tokens.needs_nickname) {
        navigate("/nickname");
        return;
      }
      navigate(from && from !== "/login" ? from : afterAuthPath(tokens));
    },
    [from, navigate],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        if (password !== passwordConfirm) {
          setError("Пароли не совпадают");
          return;
        }
        if (!acceptedTerms) {
          setError("Необходимо принять Пользовательское соглашение");
          return;
        }
        const result = await register(
          email,
          password,
          passwordConfirm,
          referralCode,
          acceptedTerms,
        );
        navigate("/verify", {
          state: { email: result.email, devCode: result.dev_code ?? null, message: result.message },
        });
        return;
      }
      const tokens = await login(email, password);
      saveTokens(tokens);
      finishAuth(tokens);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка запроса";
      if (message.includes("Подтвердите email")) {
        navigate("/verify", { state: { email, message } });
        return;
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const registerDisabled = busy || (mode === "register" && !acceptedTerms);

  return (
    <section className="auth-layout">
      <div className="auth-card">
        <h1>{mode === "login" ? "Вход" : "Регистрация"}</h1>
        <p className="lead muted">
          {mode === "login"
            ? "Войдите в аккаунт, чтобы собирать стратегии и анализировать игру."
            : "Создайте аккаунт — на почту придёт код подтверждения."}
        </p>

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
            autoComplete="email"
            required
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
          {mode === "register" ? (
            <>
              <label htmlFor="passwordConfirm">Повтор пароля</label>
              <input
                id="passwordConfirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
              <label htmlFor="referralCode">Реферальный код</label>
              <input
                id="referralCode"
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                autoComplete="off"
                placeholder="Если есть"
                maxLength={32}
              />
              <label className="terms-check" htmlFor="acceptedTerms">
                <input
                  id="acceptedTerms"
                  type="checkbox"
                  className="terms-check-input"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                />
                <span className="terms-check-box" aria-hidden="true" />
                <span className="terms-check-text">
                  Я принимаю условия{" "}
                  <button
                    type="button"
                    className="terms-link"
                    onClick={(e) => {
                      e.preventDefault();
                      setTermsOpen(true);
                    }}
                  >
                    Пользовательского соглашения
                  </button>{" "}
                  и Политики конфиденциальности
                </span>
              </label>
            </>
          ) : null}
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={registerDisabled}>
            {busy ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
          <p className="muted" style={{ marginTop: "1rem" }}>
            {mode === "login" ? (
              <>
                Нет аккаунта?{" "}
                <button type="button" className="linkish" onClick={() => setMode("register")}>
                  Зарегистрироваться
                </button>
              </>
            ) : (
              <>
                Уже есть аккаунт?{" "}
                <button type="button" className="linkish" onClick={() => setMode("login")}>
                  Войти
                </button>
              </>
            )}
          </p>
        </form>
      </div>

      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </section>
  );
}
