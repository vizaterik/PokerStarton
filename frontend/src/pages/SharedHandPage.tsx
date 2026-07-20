import { Link, useParams } from "react-router-dom";
import BrandMark from "../components/BrandMark";
import HandReplayModal from "../components/HandReplayModal";
import SharedHandSocial from "../components/SharedHandSocial";
import { BRAND } from "../lib/brand";

export default function SharedHandPage() {
  const { token = "" } = useParams<{ token: string }>();

  if (!token.trim()) {
    return (
      <div className="share-hand-page">
        <p className="share-hand-error">Некорректная ссылка</p>
        <Link to="/">На главную</Link>
      </div>
    );
  }

  return (
    <div className="share-hand-page">
      <header className="share-hand-bar">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand-name" data-text={BRAND}>
            {BRAND}
          </span>
        </Link>
        <span className="share-hand-badge">Публичная раздача</span>
      </header>
      <HandReplayModal
        open
        pageMode
        publicToken={token}
        label="Shared hand"
        onClose={() => undefined}
      />
      <div className="share-social-wrap">
        <SharedHandSocial token={token} />
      </div>
    </div>
  );
}
