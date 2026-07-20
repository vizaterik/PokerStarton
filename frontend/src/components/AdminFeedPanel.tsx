import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getAdminFeedSettings,
  ingestAdminFeedPost,
  listAdminFeedPosts,
  publishAdminFeedPost,
  rejectAdminFeedPost,
  runAdminFeedAuto,
  updateAdminFeedSettings,
  type FeedPostListItem,
  type FeedSettings,
} from "../api/client";

export default function AdminFeedPanel() {
  const [settings, setSettings] = useState<FeedSettings | null>(null);
  const [posts, setPosts] = useState<FeedPostListItem[]>([]);
  const [queriesText, setQueriesText] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [rawHh, setRawHh] = useState("");
  const [publishOnIngest, setPublishOnIngest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [s, p] = await Promise.all([
      getAdminFeedSettings(),
      listAdminFeedPosts(null, 40),
    ]);
    setSettings(s);
    setQueriesText((s.search_queries || []).join("\n"));
    setPosts(p.items);
  }, []);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Не удалось загрузить ленту");
    });
  }, [reload]);

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const next = await updateAdminFeedSettings({
        ...settings,
        search_queries: queriesText
          .split("\n")
          .map((q) => q.trim())
          .filter(Boolean),
      });
      setSettings(next);
      setInfo("Настройки сохранены");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function onIngest() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const post = await ingestAdminFeedPost({
        youtube_url: youtubeUrl.trim() || undefined,
        raw_hh: rawHh.trim() || undefined,
        publish: publishOnIngest,
      });
      setInfo(`Пост создан: ${post.title} (${post.status})`);
      setYoutubeUrl("");
      setRawHh("");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка ingest");
    } finally {
      setBusy(false);
    }
  }

  async function onRunAuto() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await runAdminFeedAuto();
      setInfo(res.message);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка автозапуска");
    } finally {
      setBusy(false);
    }
  }

  async function onPublish(id: string) {
    setBusy(true);
    setError(null);
    try {
      await publishAdminFeedPost(id);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка публикации");
    } finally {
      setBusy(false);
    }
  }

  async function onReject(id: string) {
    setBusy(true);
    setError(null);
    try {
      await rejectAdminFeedPost(id);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка отклонения");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return <p className="muted">Загрузка настроек ленты…</p>;
  }

  return (
    <section className="admin-block admin-feed-panel">
      <h2>Лента AI-разборов</h2>
      <p className="muted">
        Автопоиск YouTube и ручная очередь. Публичная страница:{" "}
        <Link to="/feed">/feed</Link>
      </p>

      {error ? <p className="error">{error}</p> : null}
      {info ? <p className="admin-feed-info">{info}</p> : null}

      <div className="admin-feed-settings">
        <label className="admin-feed-check">
          <input
            type="checkbox"
            checked={settings.auto_enabled}
            onChange={(e) =>
              setSettings({ ...settings, auto_enabled: e.target.checked })
            }
          />
          Автопоиск YouTube
        </label>
        <label className="admin-feed-check">
          <input
            type="checkbox"
            checked={settings.auto_publish}
            onChange={(e) =>
              setSettings({ ...settings, auto_publish: e.target.checked })
            }
          />
          Автопубликация (иначе черновик)
        </label>
        <label>
          Лимит постов / день
          <input
            type="number"
            min={1}
            max={50}
            value={settings.max_posts_per_day}
            onChange={(e) =>
              setSettings({
                ...settings,
                max_posts_per_day: Number(e.target.value) || 1,
              })
            }
          />
        </label>
        <label>
          Мин. просмотров
          <input
            type="number"
            min={0}
            value={settings.min_views}
            onChange={(e) =>
              setSettings({
                ...settings,
                min_views: Number(e.target.value) || 0,
              })
            }
          />
        </label>
        <label>
          Модель
          <input
            value={settings.model_name}
            onChange={(e) =>
              setSettings({ ...settings, model_name: e.target.value })
            }
          />
        </label>
        <label className="admin-feed-queries">
          Поисковые запросы (по одному в строке)
          <textarea
            rows={4}
            value={queriesText}
            onChange={(e) => setQueriesText(e.target.value)}
          />
        </label>
        <div className="admin-feed-actions">
          <button type="button" className="cta" disabled={busy} onClick={() => void saveSettings()}>
            Сохранить настройки
          </button>
          <button
            type="button"
            className="cta-secondary"
            disabled={busy}
            onClick={() => void onRunAuto()}
          >
            Запустить автосейчас
          </button>
        </div>
      </div>

      <div className="admin-feed-ingest">
        <h3>Добавить вручную</h3>
        <label>
          YouTube URL
          <input
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </label>
        <label>
          Или HH текст
          <textarea
            rows={5}
            value={rawHh}
            onChange={(e) => setRawHh(e.target.value)}
            placeholder="PokerStars Hand #..."
          />
        </label>
        <label className="admin-feed-check">
          <input
            type="checkbox"
            checked={publishOnIngest}
            onChange={(e) => setPublishOnIngest(e.target.checked)}
          />
          Сразу опубликовать
        </label>
        <button type="button" className="cta" disabled={busy} onClick={() => void onIngest()}>
          Отправить в AI
        </button>
      </div>

      <div className="admin-feed-queue">
        <h3>Очередь ({posts.length})</h3>
        {posts.length === 0 ? (
          <p className="muted">Пока пусто.</p>
        ) : (
          <ul className="admin-feed-post-list">
            {posts.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.title}</strong>
                  <span className={`admin-feed-status is-${p.status}`}>{p.status}</span>
                  <p className="muted">{p.analysis_preview}</p>
                </div>
                <div className="admin-feed-row-actions">
                  <Link to={`/feed/${p.id}`}>Открыть</Link>
                  {p.status !== "published" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onPublish(p.id)}
                    >
                      Опубликовать
                    </button>
                  ) : null}
                  {p.status !== "rejected" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onReject(p.id)}
                    >
                      Отклонить
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
