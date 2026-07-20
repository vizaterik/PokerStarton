import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ShareStreet } from "../api/client";
import BrandMark from "../components/BrandMark";
import HandReplayModal from "../components/HandReplayModal";
import SharedHandSocial from "../components/SharedHandSocial";
import { BRAND } from "../lib/brand";

export default function SharedHandPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [currentStreet, setCurrentStreet] = useState<ShareStreet>("preflop");
  const [playedStreets, setPlayedStreets] = useState<ShareStreet[]>(["preflop"]);
  const [unlockedStreets, setUnlockedStreets] = useState<ShareStreet[]>(["preflop"]);

  const onStreetProgress = useCallback(
    (info: {
      currentStreet: ShareStreet;
      playedStreets: ShareStreet[];
      unlockedStreets: ShareStreet[];
    }) => {
      setCurrentStreet(info.currentStreet);
      setPlayedStreets(info.playedStreets);
      setUnlockedStreets(info.unlockedStreets);
    },
    [],
  );

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
      <SharedHandSocial
        token={token}
        currentStreet={currentStreet}
        playedStreets={playedStreets}
        unlockedStreets={unlockedStreets}
      >
        {(likeControl) => (
          <HandReplayModal
            open
            pageMode
            publicToken={token}
            label="Shared hand"
            topbarExtra={likeControl}
            onStreetProgress={onStreetProgress}
            onClose={() => undefined}
          />
        )}
      </SharedHandSocial>
    </div>
  );
}
