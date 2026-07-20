import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getFeedPost, type FeedPostDetail } from "../api/client";
import HandReplayModal from "../components/HandReplayModal";
import { buildReplayFromRawText } from "../engine/localReplay";

function renderSimpleMarkdown(md: string) {
  const blocks = (md || "").split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    const heading = lines[0]?.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      return (
        <div key={i} className="feed-md-block">
          <h3>{heading[1]}</h3>
          {lines.slice(1).map((ln, j) => (
            <p key={j}>{ln}</p>
          ))}
        </div>
      );
    }
    return (
      <div key={i} className="feed-md-block">
        {lines.map((ln, j) => (
          <p key={j}>{ln}</p>
        ))}
      </div>
    );
  });
}

export default function FeedPostPage() {
  const { postId = "" } = useParams<{ postId: string }>();
  const [post, setPost] = useState<FeedPostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReplay, setShowReplay] = useState(false);

  useEffect(() => {
    if (!postId.trim()) return;
    let cancelled = false;
    setLoading(true);
    void getFeedPost(postId)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Пост не найден");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const replayHand = useMemo(() => {
    if (!post?.hand_raw_text?.trim()) return null;
    try {
      const hand = buildReplayFromRawText(post.hand_raw_text, {
        id: `feed-${post.id}`,
        hero_hand: post.hero_hand,
      });
      if (!hand.actions.length && hand.seats.length === 0) return null;
      return hand;
    } catch {
      return null;
    }
  }, [post]);

  if (loading) {
    return (
      <section className="page">
        <p className="muted">Загрузка…</p>
      </section>
    );
  }

  if (error || !post) {
    return (
      <section className="page">
        <p className="error">{error || "Пост не найден"}</p>
        <Link to="/feed">← К ленте</Link>
      </section>
    );
  }

  return (
    <section className="page feed-post-page">
      <p className="feed-back">
        <Link to="/feed">← Лента разборов</Link>
      </p>
      <header className="feed-post-head">
        <h1>{post.title}</h1>
        <div className="feed-meta">
          {post.stakes_label ? <span>{post.stakes_label}</span> : null}
          {post.hero_hand ? <span>{post.hero_hand}</span> : null}
          {post.source_channel ? <span>{post.source_channel}</span> : null}
          {post.published_at ? (
            <span>{new Date(post.published_at).toLocaleDateString("ru-RU")}</span>
          ) : null}
        </div>
        {post.source_url ? (
          <p className="feed-source">
            Источник:{" "}
            <a href={post.source_url} target="_blank" rel="noreferrer">
              {post.source_title || post.source_url}
            </a>
          </p>
        ) : null}
      </header>

      <article className="feed-analysis">{renderSimpleMarkdown(post.analysis_md)}</article>

      {(replayHand || post.has_replay) && (
        <div className="feed-replay-actions">
          <button
            type="button"
            className="cta"
            disabled={!replayHand}
            onClick={() => setShowReplay(true)}
          >
            Смотреть раздачу
          </button>
          {!replayHand ? (
            <p className="muted">HH не удалось разобрать для реплея.</p>
          ) : null}
        </div>
      )}

      {showReplay && replayHand ? (
        <HandReplayModal
          open
          label="AI feed"
          embeddedHand={replayHand}
          onClose={() => setShowReplay(false)}
        />
      ) : null}
    </section>
  );
}
