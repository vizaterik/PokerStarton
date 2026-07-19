import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  clearHandDatabase,
  createHandDatabase,
  deleteHandDatabase,
  listHandDatabases,
  switchHandDatabase,
  type HandDatabase,
} from "../api/client";
import ConfirmDialog from "./ConfirmDialog";
import { clearAnalysisCache } from "../lib/analysisCache";
import { clearHandDbMeta, metaFromDatabase, writeHandDbMeta } from "../lib/handDbCache";
import { clearResultsCache } from "../lib/resultsCache";

export default function DatabasesPanel() {
  const [items, setItems] = useState<HandDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "clear"; db: HandDatabase }
    | { kind: "delete"; db: HandDatabase }
    | null
  >(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listHandDatabases();
      setItems(rows);
      const active = rows.find((d) => d.is_active) ?? rows[0];
      if (active) writeHandDbMeta(metaFromDatabase(active));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить базы");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNote("Будим сервер и создаём базу — на Free это может занять до минуты…");
    try {
      await createHandDatabase(name.trim(), true);
      clearAnalysisCache();
      clearResultsCache();
      clearHandDbMeta();
      setName("");
      setNote(null);
      await reload();
    } catch (err) {
      setNote(null);
      setError(err instanceof Error ? err.message : "Не удалось создать базу");
    } finally {
      setBusy(false);
    }
  }

  async function onSwitch(db: HandDatabase) {
    if (db.is_active || busy) return;
    setBusy(true);
    setError(null);
    try {
      await switchHandDatabase(db.id);
      clearAnalysisCache();
      clearResultsCache();
      clearHandDbMeta();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переключить базу");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmAction() {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const targetName = confirm.db.name;
    const kind = confirm.kind;
    try {
      if (kind === "clear") {
        await clearHandDatabase(confirm.db.id);
        setNote(`База «${targetName}» очищена — руки удалены`);
      } else {
        const res = await deleteHandDatabase(confirm.db.id);
        if (res.deleted) {
          setNote(`База «${targetName}» удалена`);
        } else if (res.reset) {
          setNote(
            `Единственную базу нельзя убрать полностью — «${targetName}» очищена и сброшена`,
          );
        } else {
          setNote(`База «${targetName}» очищена`);
        }
      }
      clearAnalysisCache();
      clearResultsCache();
      clearHandDbMeta();
      setConfirm(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-card databases-panel">
      <header className="databases-panel-head">
        <div>
          <h2>Базы данных</h2>
          <p className="muted">
            Каждая база хранит руки, сессии и загрузки (лимит 100&nbsp;000 рук на базу). Можно
            создать новую, переключиться или очистить историю.
          </p>
        </div>
      </header>

      <form className="databases-create" onSubmit={(e) => void onCreate(e)}>
        <label>
          Новая база
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: MTT 2026"
            maxLength={120}
            disabled={busy}
          />
        </label>
        <button type="submit" className="cta" disabled={busy || !name.trim()}>
          Создать и перейти
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="muted">{note}</p> : null}
      {loading ? <p className="muted">Загрузка баз…</p> : null}

      <ul className="databases-list">
        {items.map((db) => (
          <li key={db.id} className={`databases-item${db.is_active ? " is-active" : ""}`}>
            <div className="databases-item-main">
              <strong>{db.name}</strong>
              {db.is_active ? <em className="databases-active">активная</em> : null}
              <span className="muted">
                {db.hands_count.toLocaleString("ru-RU")} /{" "}
                {(db.hands_limit ?? 100000).toLocaleString("ru-RU")} рук · {db.sessions_count}{" "}
                сессий · {db.uploads_count} загрузок
              </span>
            </div>
            <div className="databases-item-actions">
              {!db.is_active ? (
                <button
                  type="button"
                  className="cta-secondary"
                  disabled={busy}
                  onClick={() => void onSwitch(db)}
                >
                  Перейти
                </button>
              ) : null}
              <button
                type="button"
                className="cta-secondary"
                disabled={busy}
                onClick={() => setConfirm({ kind: "clear", db })}
              >
                Очистить руки
              </button>
              <button
                type="button"
                className="cta-secondary danger-btn"
                disabled={busy}
                title={
                  items.length <= 1
                    ? "Единственную базу нельзя убрать — очистим все руки"
                    : "Удалить базу"
                }
                onClick={() => setConfirm({ kind: "delete", db })}
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(confirm)}
        danger={confirm?.kind === "delete"}
        busy={busy}
        title={
          confirm?.kind === "delete"
            ? items.length <= 1
              ? `Очистить единственную базу «${confirm.db.name}»?`
              : `Удалить базу «${confirm.db.name}»?`
            : `Очистить базу «${confirm?.db.name}»?`
        }
        confirmLabel={
          confirm?.kind === "delete"
            ? items.length <= 1
              ? "Очистить базу"
              : "Удалить базу"
            : "Очистить руки"
        }
        cancelLabel="Отмена"
        onCancel={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={() => void onConfirmAction()}
        description={
          confirm?.kind === "delete" ? (
            items.length <= 1 ? (
              <p>
                Это единственная база профиля — строку нельзя убрать полностью. Удалим все руки,
                сессии и загрузки; база останется пустой (название сбросится на «Основная»).
              </p>
            ) : (
              <p>
                Будут удалены все руки, сессии и файлы этой базы, и сама база исчезнет из списка.
                Стратегии и банкролл аккаунта останутся. Если база активна — переключимся на
                другую.
              </p>
            )
          ) : (
            <p>
              Удалятся все руки, сессии и загрузки внутри базы. Сама база останется пустой — можно
              заново загружать историю.
            </p>
          )
        }
      />
    </div>
  );
}
