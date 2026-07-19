import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearTokens, getMe, User } from "../api/client";
import { userInitials } from "../lib/userInitials";

export default function UserMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const onProfile = location.pathname.startsWith("/profile");

  useEffect(() => {
    void getMe()
      .then(setUser)
      .catch(() => {
        clearTokens();
        window.location.assign("/login");
      });
  }, [location.pathname]);

  if (!user) {
    return <span className="profile-chip muted">Профиль…</span>;
  }

  return (
    <div className="profile-menu">
      <button
        type="button"
        className={`profile-chip${onProfile ? " is-active" : ""}`}
        aria-current={onProfile ? "page" : undefined}
        onClick={() => navigate("/profile")}
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="profile-avatar" />
        ) : (
          <span className="profile-avatar fallback">{userInitials(user.display_name)}</span>
        )}
        <span className="profile-chip-name">{user.display_name || "Профиль"}</span>
      </button>
    </div>
  );
}
