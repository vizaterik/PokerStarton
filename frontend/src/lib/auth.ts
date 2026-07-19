import { clearTokens } from "../api/client";

/** Hard logout: clear session and reload into login. */
export function logout() {
  clearTokens();
  // Full navigation avoids stale React auth state.
  window.location.assign("/#/login");
}
