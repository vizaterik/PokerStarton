import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  fetchHandShareSocial,
  isLoggedIn,
  postHandShareComment,
  toggleHandShareCommentLike,
  toggleHandShareLike,
  type HandShareSocial,
  type ShareStreet,
} from "../api/client";
import { SHARE_STREET_LABELS } from "../lib/shareStreets";

type Slot = {
  likeBar: ReactNode;
};

type Props = {
  token: string;
  playedStreets: ShareStreet[];
  unlockedStreets: ShareStreet[];
  currentStreet: ShareStreet;
  children: (slot: Slot) => ReactNode;
};

export default function SharedHandSocial({
  token,
  playedStreets,
  unlockedStreets,
  currentStreet,
  children,
}: Props) {
  const [data, setData] = useState<HandShareSocial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<ShareStreet, string>>({
    preflop: "",
    flop: "",
    turn: "",
    river: "",
  });
  const [savingStreet, setSavingStreet] = useState<ShareStreet | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [commentLikeBusy, setCommentLikeBusy] = useState<string | null>(null);
  const loggedIn = isLoggedIn();

  const visibleStreets = useMemo(() => {
    const unlock = new Set(unlockedStreets);
    return playedStreets.filter((s) => unlock.has(s));
  }, [playedStreets, unlockedStreets]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const social = await fetchHandShareSocial(token);
      setData(social);
      setDrafts({
        preflop: social.my_comments_by_street.preflop || "",
        flop: social.my_comments_by_street.flop || "",
        turn: social.my_comments_by_street.turn || "",
        river: social.my_comments_by_street.river || "",
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLike() {
    if (!loggedIn) return;
    setLikeBusy(true);
    setError(null);
    try {
      const res = await toggleHandShareLike(token);
      setData((prev) =>
        prev
          ? { ...prev, likes_count: res.likes_count, liked_by_me: res.liked_by_me }
          : prev,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось лайкнуть");
    } finally {
      setLikeBusy(false);
    }
  }

  async function onCommentLike(commentId: string) {
    if (!loggedIn) return;
    setCommentLikeBusy(commentId);
    setError(null);
    try {
      const res = await toggleHandShareCommentLike(token, commentId);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          comments: prev.comments.map((c) =>
            c.id === res.comment_id
              ? { ...c, likes_count: res.likes_count, liked_by_me: res.liked_by_me }
              : c,
          ),
        };
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось лайкнуть комментарий");
    } finally {
      setCommentLikeBusy(null);
    }
  }

  async function onSaveComment(street: ShareStreet) {
    if (!loggedIn) return;
    const body = (drafts[street] || "").trim();
    if (!body) {
      setError("Напишите комментарий");
      return;
    }
    setSavingStreet(street);
    setError(null);
    try {
      const social = await postHandShareComment(token, street, body);
      setData(social);
      setDrafts({
        preflop: social.my_comments_by_street.preflop || "",
        flop: social.my_comments_by_street.flop || "",
        turn: social.my_comments_by_street.turn || "",
        river: social.my_comments_by_street.river || "",
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSavingStreet(null);
    }
  }

  const commentsByStreet = (street: ShareStreet) =>
    (data?.comments || []).filter((c) => c.street === street);

  const lockedAhead = playedStreets.filter((s) => !visibleStreets.includes(s));

  const likeBar = (
    <div className="share-like-bar">
      <button
        type="button"
        className={`share-like-btn share-like-btn-lg${data?.liked_by_me ? " is-liked" : ""}`}
        disabled={!loggedIn || likeBusy || loading}
        onClick={() => void onLike()}
        title={loggedIn ? "Лайкнуть раздачу" : "Войдите, чтобы лайкнуть"}
      >
        <span className="share-like-heart" aria-hidden>
          ♥
        </span>
        <span className="share-like-meta">
          <strong>{data?.likes_count ?? 0}</strong>
          <em>{data?.liked_by_me ? "Нравится" : "Нравится раздача"}</em>
        </span>
      </button>
      {!loggedIn && (
        <p className="share-social-hint share-like-login">
          <Link to="/login">Войдите</Link>, чтобы лайкнуть
        </p>
      )}
    </div>
  );

  return (
    <>
      {children({ likeBar })}

      <div className="share-social-wrap">
        <section className="share-social" aria-label="Комментарии">
          <div className="share-social-head">
            <h3>Обсуждение раздачи</h3>
          </div>

          <p className="share-social-hint share-social-progress">
            Сейчас: <strong>{SHARE_STREET_LABELS[currentStreet]}</strong>
            {" · "}
            полный текст — только на текущей улице
          </p>

          {!loggedIn && (
            <p className="share-social-hint">
              <Link to="/login">Войдите</Link>, чтобы лайкать и комментировать.
            </p>
          )}
          {error && <p className="share-social-error">{error}</p>}
          {loading && <p className="share-social-muted">Загрузка…</p>}

          {!loading && visibleStreets.length === 0 && (
            <p className="share-social-muted">
              Листайте реплей — откроется комментарий к улице
            </p>
          )}

          {!loading &&
            visibleStreets.map((key) => {
              const list = commentsByStreet(key);
              const mine = Boolean(data?.my_comments_by_street[key]);
              const isCurrent = key === currentStreet;
              const countLabel = list.length === 0 ? "нет" : `${list.length}`;

              if (!isCurrent) {
                return (
                  <div key={key} className="share-street-block share-street-summary">
                    <div className="share-street-title">
                      {SHARE_STREET_LABELS[key]}
                      <span className="share-street-count">{countLabel}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={key} className="share-street-block is-current">
                  <div className="share-street-title">
                    {SHARE_STREET_LABELS[key]}
                    <span className="share-street-now">сейчас</span>
                    <span className="share-street-count">{countLabel}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="share-social-muted">Пока нет комментариев</p>
                  ) : (
                    <ul className="share-comment-list">
                      {list.map((c) => (
                        <li key={c.id} className={c.is_mine ? "is-mine" : undefined}>
                          <div className="share-comment-head">
                            <strong>{c.author_name}</strong>
                            <button
                              type="button"
                              className={`share-comment-like${c.liked_by_me ? " is-liked" : ""}`}
                              disabled={!loggedIn || commentLikeBusy === c.id}
                              onClick={() => void onCommentLike(c.id)}
                              title={
                                loggedIn
                                  ? "Лайкнуть комментарий"
                                  : "Войдите, чтобы лайкнуть"
                              }
                            >
                              ♥ {c.likes_count ?? 0}
                            </button>
                          </div>
                          <span>{c.body}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {loggedIn && (
                    <div className="share-comment-form">
                      <textarea
                        value={drafts[key]}
                        maxLength={1000}
                        rows={2}
                        placeholder={
                          mine
                            ? "Ваш комментарий (можно изменить)"
                            : `Комментарий к улице «${SHARE_STREET_LABELS[key]}»`
                        }
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        disabled={savingStreet === key}
                        onClick={() => void onSaveComment(key)}
                      >
                        {savingStreet === key
                          ? "…"
                          : mine
                            ? "Обновить"
                            : "Отправить"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

          {!loading && lockedAhead.length > 0 && (
            <p className="share-social-muted share-social-locked">
              Дальше откроется:{" "}
              {lockedAhead.map((s) => SHARE_STREET_LABELS[s]).join(" → ")}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
