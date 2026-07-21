import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import BrandMark from "./components/BrandMark";
import GuestOnly from "./components/GuestOnly";
import {
  IconAcademy,
  IconAdmin,
  IconHits,
} from "./components/NavIcons";
import PracticeNavMenu from "./components/PracticeNavMenu";
import RequireAuth from "./components/RequireAuth";
import SiteFooter from "./components/SiteFooter";
import SupportWidget from "./components/SupportWidget";
import UserMenu from "./components/UserMenu";
import { getMe, isLoggedIn, startApiKeepAlive, stopApiKeepAlive, trackPageView } from "./api/client";
import AcademyPage from "./pages/AcademyPage";
import AdminPage from "./pages/AdminPage";
import CareerPage from "./pages/CareerPage";
import FeedPage from "./pages/FeedPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import LogoutPage from "./pages/LogoutPage";
import NicknamePage from "./pages/NicknamePage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";
import SharedHandPage from "./pages/SharedHandPage";
import StrategiesPage from "./pages/StrategiesPage";
import StrategyEditorPage from "./pages/StrategyEditorPage";
import AnalysisPage from "./pages/AnalysisPage";
import TrainerPage from "./pages/TrainerPage";
import UploadPage from "./pages/UploadPage";
import VerifyPage from "./pages/VerifyPage";
import { BRAND } from "./lib/brand";
import { warmHandDbAndResultsCache } from "./lib/warmCaches";
import "./App.css";
import "./terminal-theme.css";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "is-active" : undefined;
}

export default function App() {
  const loggedIn = isLoggedIn();
  const location = useLocation();
  const isSharePage = location.pathname.startsWith("/h/");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (isSharePage) return;
    void trackPageView(location.pathname + location.search, document.referrer || undefined);
  }, [location.pathname, location.search, isSharePage]);

  useEffect(() => {
    if (!loggedIn) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void getMe()
      .then((me) => {
        if (!cancelled) setIsAdmin(Boolean(me.is_admin));
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, location.pathname]);

  useEffect(() => {
    if (!loggedIn) {
      stopApiKeepAlive();
      return;
    }
    // Prefetch active hand DB + career report into localStorage for instant open.
    void warmHandDbAndResultsCache();
    // Keep Free Render API awake while the tab is open.
    startApiKeepAlive();
    return () => stopApiKeepAlive();
  }, [loggedIn]);

  if (isSharePage) {
    return (
      <Routes>
        <Route path="/h/:token" element={<SharedHandPage />} />
      </Routes>
    );
  }

  return (
    <div className="shell">
      <div className="app-suits-bg" aria-hidden>
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
      </div>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <BrandMark />
            <span className="brand-name" data-text={BRAND}>
              {BRAND}
            </span>
            <span className="brand-beta">beta</span>
          </Link>
          <nav className="topbar-nav">
            {loggedIn ? (
              <>
                <NavLink to="/academy" className={navClass}>
                  <IconAcademy />
                  <span>Академия</span>
                </NavLink>
                <PracticeNavMenu />
                <NavLink to="/feed" className={navClass}>
                  <IconHits />
                  <span>Топ дня</span>
                </NavLink>
                {isAdmin ? (
                  <NavLink to="/admin" className={navClass}>
                    <IconAdmin />
                    <span>Админ</span>
                  </NavLink>
                ) : null}
                <UserMenu />
              </>
            ) : (
              <>
                <NavLink to="/feed" className={navClass}>
                  <IconHits />
                  <span>Топ дня</span>
                </NavLink>
                <Link className="nav-ghost" to="/login" state={{ mode: "login" }}>
                  Вход
                </Link>
                <Link className="nav-cta" to="/login" state={{ mode: "register" }}>
                  Зарегистрироваться
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/logout" element={<LogoutPage />} />
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/u/:displayName" element={<PublicProfilePage />} />

          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/verify" element={<VerifyPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/academy" element={<AcademyPage />} />
            <Route path="/nickname" element={<NicknamePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/strategies" element={<StrategiesPage />} />
            <Route path="/strategies/:strategyId" element={<StrategyEditorPage />} />
            <Route path="/trainer" element={<TrainerPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/career" element={<CareerPage />} />
            <Route path="/results" element={<Navigate to="/career" replace />} />
          </Route>

          <Route path="*" element={<Navigate to={loggedIn ? "/strategies" : "/login"} replace />} />
        </Routes>
      </main>
      <SiteFooter />
      <SupportWidget />
    </div>
  );
}
