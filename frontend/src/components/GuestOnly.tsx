import { Navigate, Outlet, useLocation } from "react-router-dom";
import { clearTokens, isLoggedIn } from "../api/client";

/** Login / verify — only for guests. Logged-in users go through auth gate (nickname if needed). */
export default function GuestOnly() {
  const location = useLocation();
  // ?force=1 clears a stuck session so the login form can open.
  const force = new URLSearchParams(location.search).get("force") === "1";
  if (force && isLoggedIn()) {
    clearTokens();
  }
  if (isLoggedIn()) {
    return <Navigate to="/strategies" replace />;
  }
  return <Outlet />;
}
