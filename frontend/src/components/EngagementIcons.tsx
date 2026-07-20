type Props = {
  views?: number | null;
  comments?: number | null;
  likes?: number | null;
  className?: string;
};

function EyeIcon() {
  return (
    <svg className="eng-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 5c-5.2 0-9.4 3.4-11 7 1.6 3.6 5.8 7 11 7s9.4-3.4 11-7c-1.6-3.6-5.8-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7.2a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg className="eng-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.2L4.6 21.2A1 1 0 0 1 3 20.4V5a2 2 0 0 1 2-2zm2 4v2h12V7H6zm0 4v2h8v-2H6z"
      />
    </svg>
  );
}

/** Filled heart for likes — used in Hits, profiles, share UI. */
export function HeartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`heart-ico${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12.1 21.35c-.1 0-.2-.05-.3-.1C7.1 17.9 4 14.55 4 10.75 4 8.05 6.05 6 8.7 6c1.45 0 2.8.7 3.6 1.8C13.1 6.7 14.45 6 15.9 6 18.55 6 20.6 8.05 20.6 10.75c0 3.8-3.1 7.15-7.8 10.5-.1.05-.2.1-.3.1h-.4z"
      />
    </svg>
  );
}

export default function EngagementIcons({ views, comments, likes, className }: Props) {
  const showViews = views != null;
  const showComments = comments != null;
  const showLikes = likes != null;
  if (!showViews && !showComments && !showLikes) return null;

  return (
    <div className={`eng-row${className ? ` ${className}` : ""}`}>
      {showViews ? (
        <span className="eng-item" title="Просмотры">
          <EyeIcon />
          <span>{views}</span>
        </span>
      ) : null}
      {showComments ? (
        <span className="eng-item" title="Комментарии">
          <CommentIcon />
          <span>{comments}</span>
        </span>
      ) : null}
      {showLikes ? (
        <span className="eng-item eng-likes" title="Лайки">
          <HeartIcon />
          <span>{likes}</span>
        </span>
      ) : null}
    </div>
  );
}
