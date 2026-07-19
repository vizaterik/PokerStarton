import { useEffect } from "react";
import { logout } from "../lib/auth";

/** Visit /logout to always end the session. */
export default function LogoutPage() {
  useEffect(() => {
    logout();
  }, []);

  return (
    <section className="page">
      <p className="muted">Выходим…</p>
    </section>
  );
}
