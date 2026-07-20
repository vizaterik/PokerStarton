import { DragEvent, FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BatchUploadReport,
  listStrategies,
  Strategy,
  uploadHands,
} from "../api/client";
import { CLIENT_HH_ENGINE, importHandsLocally } from "../engine/hhClient";
import { finalizeLocalAnalysis } from "../engine/localAnalysis";
import { uploadLocalAnalysisSnapshot } from "../engine/uploadAnalysisSnapshot";
import { readLastStrategyId, writeLastStrategyId } from "../lib/handDbCache";
import {
  completeClientImport,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  updateClientImportProgress,
} from "../lib/analysisJob";
import {
  STRATEGY_CHARTS_GAP_HINT,
  strategyHasPlayCharts,
} from "../lib/gameTree/strategyReady";
import { clearResultsCache } from "../lib/resultsCache";
import { warmHandDbAndResultsCache } from "../lib/warmCaches";
import AnalysisCalcProgress from "./AnalysisCalcProgress";

function looksLikeHandHistory(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".log") || name.endsWith(".hh")) return true;
  if (file.type === "text/plain" || file.type === "") return true;
  return false;
}

function mergeFiles(prev: File[], incoming: File[]) {
  const map = new Map<string, File>();
  for (const f of prev) map.set(`${f.name}-${f.size}-${f.lastModified}`, f);
  for (const f of incoming) {
    map.set(`${f.name}-${f.size}-${f.lastModified}`, f);
  }
  return [...map.values()];
}

type Props = {
  /** Fixed strategy (editor). If omitted, shows a strategy selector. */
  strategyId?: string;
  onStrategyIdChange?: (id: string) => void;
  /** Compact dropzone for embedding above an existing analysis. */
  compact?: boolean;
  /** Fires as soon as upload begins — stop prior analysis / clear stale stats. */
  onUploadStarted?: (strategyId: string, estimatedHands?: number) => void;
  /** Fires after upload attempt ends (success or failure). */
  onUploadFinished?: (strategyId: string, ok: boolean) => void;
  onUploaded?: (report: BatchUploadReport, strategyId: string) => void;
  /**
   * client = parse + HUD + auto snapshot upload.
   * server = legacy multipart upload.
   * auto = client when CLIENT_HH_ENGINE is on.
   */
  importMode?: "auto" | "client" | "server";
};

export default function SessionUploadPanel({
  strategyId: controlledStrategyId,
  onStrategyIdChange,
  compact = false,
  onUploadStarted,
  onUploadFinished,
  onUploaded,
  importMode = "auto",
}: Props) {
  const useClient =
    importMode === "client" || (importMode === "auto" && CLIENT_HH_ENGINE);
  const inputId = useId();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [internalStrategyId, setInternalStrategyId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadEstimate, setUploadEstimate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchUploadReport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const strategyId = controlledStrategyId ?? internalStrategyId;
  const showStrategySelect = controlledStrategyId == null;

  useEffect(() => {
    if (!showStrategySelect) return;
    let cancelled = false;
    void listStrategies()
      .then((items) => {
        if (cancelled) return;
        setStrategies(items);
        setInternalStrategyId((prev) => {
          if (prev) return prev;
          const remembered = readLastStrategyId();
          const pick =
            (remembered && items.some((s) => s.id === remembered) ? remembered : null) ||
            items[0]?.id ||
            "";
          if (!pick) return prev;
          onStrategyIdChange?.(pick);
          writeLastStrategyId(pick);
          return pick;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить стратегии");
        }
      });
    return () => {
      cancelled = true;
    };
    // Intentionally only on mount when selector is shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStrategySelect]);

  const setStrategyId = useCallback(
    (id: string) => {
      if (controlledStrategyId == null) setInternalStrategyId(id);
      onStrategyIdChange?.(id);
    },
    [controlledStrategyId, onStrategyIdChange],
  );

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const accepted = incoming.filter(looksLikeHandHistory);
    const rejected = incoming.length - accepted.length;
    if (accepted.length === 0) {
      setHint("Для анализа принимаются файлы .txt");
      return;
    }
    setHint(rejected > 0 ? `Добавлено ${accepted.length}, пропущено ${rejected}` : null);
    setError(null);
    setFiles((prev) => mergeFiles(prev, accepted));
  }, []);

  const runUpload = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) {
        setError("Сначала выбери или перетащи файлы");
        return;
      }
      if (!strategyId) {
        setError("Выбери стратегию");
        return;
      }
      setBusy(true);
      const estimatedHands = Math.max(
        1,
        Math.round(fileList.reduce((sum, f) => sum + f.size, 0) / 1200),
      );
      setUploadEstimate(estimatedHands);
      setError(null);
      setHint(null);
      setBatch(null);
      // Stop previous analysis/stats immediately — do not wait for work to finish.
      onUploadStarted?.(strategyId, estimatedHands);
      markAnalysisUploadStarted(strategyId, estimatedHands, {
        external: useClient,
      });
      let ok = false;
      try {
        const result = useClient
          ? await importHandsLocally(fileList, strategyId, (p) => {
              updateClientImportProgress(
                strategyId,
                p.pct,
                p.message,
                p.total > 0 ? p.total : estimatedHands,
              );
            })
          : await uploadHands(fileList, strategyId);

        const dups = result.total_duplicates_skipped ?? 0;
        // Re-import of the same file: 0 new rows but hands already in IndexedDB.
        const clientHasWork = useClient && (result.total_hands > 0 || dups > 0);

        let uploadNote: string | null = null;
        if (clientHasWork) {
          const allDupes = dups > 0 && result.total_hands === dups;
          const handCount = Math.max(result.total_hands, dups);
          updateClientImportProgress(
            strategyId,
            85,
            allDupes
              ? "Раздачи уже загружены — обновляем отчёт…"
              : "Собираем HUD и график…",
            handCount,
          );
          const fin = await finalizeLocalAnalysis(strategyId, (p) => {
            // Map HUD/deviations into 55–72; upload phase owns 72–100 (MB).
            let pct = 55;
            if (p.phase === "done") pct = 72;
            else if (p.phase === "deviations") {
              const t = Math.min(1, Math.max(0, (p.pct - 20) / 70));
              pct = Math.round(56 + t * 16);
            } else if (p.phase === "hud") {
              pct = 55;
            } else {
              pct = Math.min(72, Math.max(55, Math.round(55 + (p.pct / 100) * 17)));
            }
            updateClientImportProgress(strategyId, pct, p.message, handCount);
          });

          const sourceFilename = fileList[0]?.name ?? "session.txt";
          updateClientImportProgress(
            strategyId,
            72,
            "Загружаем отчёт в базу…",
            fin.hands,
          );
          const snap = await uploadLocalAnalysisSnapshot(strategyId, {
            label: `Сессия · ${sourceFilename}`,
            sourceFilename,
            onProgress: (message, pct) => {
              // Snapshot phase 0–100 → overall 72–99.
              updateClientImportProgress(
                strategyId,
                Math.min(99, 72 + Math.round((pct / 100) * 27)),
                message,
                fin.hands,
              );
            },
          });

          if (snap.ok) {
            // Career report is written in uploadLocalAnalysisSnapshot; warm only refreshes DB meta.
            if (!snap.response?.career_report) clearResultsCache();
            void warmHandDbAndResultsCache();
            const n = fin.hands.toLocaleString("ru-RU");
            const added = result.total_hands > 0 ? result.total_hands : snap.handsSaved;
            if (added > 0 && (dups > 0 || snap.duplicatesSkipped > 0)) {
              uploadNote = `Сессия в базе · +${added.toLocaleString("ru-RU")} новых · всего в отчёте ${n} рук (стек сессий)`;
            } else if (added > 0) {
              uploadNote = `Сессия в базе · +${added.toLocaleString("ru-RU")} · всего в отчёте ${n} рук`;
            } else {
              // Upload OK, но новых строк нет — раздачи уже лежали в профиле.
              uploadNote = `Дубли пропущены · отчёт по всей базе · ${n} рук`;
            }
            if (!strategyHasPlayCharts(strategyId)) {
              uploadNote = `${uploadNote}. ${STRATEGY_CHARTS_GAP_HINT}`;
            }
            completeClientImport(strategyId, fin.hands, uploadNote);
          } else {
            const why = snap.error ? `: ${snap.error}` : "";
            uploadNote = `Сессия разобрана локально · ${fin.hands.toLocaleString("ru-RU")} рук. Не удалось обновить базу профиля${why}`;
            setError(uploadNote);
            completeClientImport(
              strategyId,
              fin.hands,
              `Локально · ${fin.hands.toLocaleString("ru-RU")} рук · база не обновлена`,
            );
            ok = false;
          }
        }

        setBatch(result);
        const failed = result.uploads.filter((u) => u.status === "failed");
        const profileSyncFailed = Boolean(
          useClient && uploadNote && uploadNote.includes("Не удалось обновить базу профиля"),
        );
        if (failed.length > 0) {
          setError(
            failed.map((u) => `${u.original_filename}: ${u.error_message || "ошибка"}`).join("; "),
          );
          ok = false;
        } else if (!useClient && result.total_hands === 0) {
          setHint("В файлах не найдено раздач. Для анализа принимаются файлы .txt");
          ok = false;
        } else if (useClient && result.total_hands === 0 && dups === 0) {
          setHint("В файлах не найдено раздач. Для анализа принимаются файлы .txt");
          markAnalysisUploadFailed(strategyId, "В файлах не найдено раздач");
          ok = false;
        } else if (profileSyncFailed) {
          setHint(uploadNote);
          ok = false;
        } else if (useClient && uploadNote) {
          setHint(uploadNote);
          ok = true;
        } else if (dups > 0) {
          setHint(
            `Импортировано ${result.total_hands.toLocaleString("ru-RU")} раздач; повторы пропущены (${dups}).`,
          );
          ok = true;
        } else {
          ok = true;
        }
        if (ok) {
          setFiles([]);
          if (fileInputRef.current) fileInputRef.current.value = "";
          onUploaded?.(result, strategyId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ошибка загрузки";
        setError(msg);
        markAnalysisUploadFailed(strategyId, msg);
      } finally {
        setBusy(false);
        setUploadEstimate(null);
        if (!ok) onUploadFinished?.(strategyId, false);
      }
    },
    [onUploadStarted, onUploadFinished, onUploaded, strategyId, useClient],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await runUpload(files);
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);

  function removeFile(key: string) {
    setFiles((prev) => prev.filter((f) => `${f.name}-${f.size}-${f.lastModified}` !== key));
  }

  return (
    <div
      className={`session-upload${compact ? " is-compact" : ""}${dragOver ? " is-dragover" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="upload-drop-overlay" aria-hidden>
          <div className="upload-drop-overlay-card">
            <strong>Отпусти файлы</strong>
            <span>Для анализа — файлы .txt</span>
          </div>
        </div>
      )}

      <form className="upload-shell" onSubmit={onSubmit}>
        {showStrategySelect && (
          <div className="upload-toolbar">
            <label className="upload-field">
              <span>Стратегия</span>
              <select
                value={strategyId}
                onChange={(e) => setStrategyId(e.target.value)}
                required
                disabled={strategies.length === 0 || busy}
              >
                {strategies.length === 0 && <option value="">Сначала соберите стратегию</option>}
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="upload-submit"
              disabled={files.length === 0 || !strategyId || busy}
            >
              {busy ? "Разбираем…" : files.length > 0 ? `Загрузить · ${files.length}` : "Загрузить"}
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".txt,.log,.hh,text/plain"
          multiple
          className="upload-file-input"
          disabled={busy}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <label htmlFor={inputId} className={`upload-dropzone${busy ? " disabled" : ""}`}>
          <span className="upload-dropzone-mark" aria-hidden />
          <strong>{compact ? "Добавить сессию" : "Перетащи файлы сюда"}</strong>
          <span>Для анализа принимаются файлы .txt · до 100&nbsp;000 рук за раз</span>
        </label>

        {files.length > 0 && (
          <div className="upload-file-tray">
            <div className="upload-file-tray-head">
              <span>
                {files.length} файл{files.length === 1 ? "" : files.length < 5 ? "а" : "ов"}
              </span>
              <em>{(totalSize / 1024).toFixed(1)} KB</em>
              <button type="button" className="upload-clear" onClick={() => setFiles([])}>
                Очистить
              </button>
            </div>
            <ul className="upload-file-chips">
              {files.map((f) => {
                const key = `${f.name}-${f.size}-${f.lastModified}`;
                return (
                  <li key={key}>
                    <span>{f.name}</span>
                    <button type="button" aria-label="Убрать" onClick={() => removeFile(key)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!showStrategySelect && (
          <button
            type="submit"
            className="upload-submit"
            disabled={files.length === 0 || !strategyId || busy}
          >
            {busy ? "Разбираем…" : files.length > 0 ? `Загрузить · ${files.length}` : "Загрузить сессию"}
          </button>
        )}

        {/* Parent (Analysis page / panel) owns the single progress bar via onUploadStarted. */}
        {busy && !onUploadStarted && (
          <AnalysisCalcProgress
            compact
            title="Загрузка сессии"
            steps={["Парсим историю рук", "Сохраняем раздачи", "Готовим анализ"]}
            stepIndex={1}
            totalHands={uploadEstimate}
            jobKey={`upload-${uploadEstimate ?? 0}-${files.length}`}
          />
        )}

        {hint && <p className="upload-hint">{hint}</p>}
        {error && (
          <>
            <p className="error">{error}</p>
            {/лимит тарифа/i.test(error) ? (
              <p className="muted">
                <Link to="/profile">Открыть тарифы в профиле</Link>
              </p>
            ) : null}
            {/лимит базы/i.test(error) ? (
              <p className="muted">
                <Link to="/profile">Управление базами в профиле</Link>
              </p>
            ) : null}
          </>
        )}
      </form>

      {/* Compact summary only when parent is not driving the analysis progress UI */}
      {batch && !onUploadStarted && (
        <div className="upload-report">
          <div className="upload-report-cell">
            <span>Файлов</span>
            <strong>{batch.files_count}</strong>
          </div>
          <div className="upload-report-cell">
            <span>Новых</span>
            <strong>{batch.total_hands}</strong>
          </div>
          {(batch.total_duplicates_skipped ?? 0) > 0 && (
            <div className="upload-report-cell">
              <span>Дубли</span>
              <strong>{batch.total_duplicates_skipped}</strong>
            </div>
          )}
          <div className="upload-report-cell ok">
            <span>Верно</span>
            <strong>{batch.total_correct}</strong>
          </div>
          <div className="upload-report-cell bad">
            <span>Ошибки</span>
            <strong>{batch.total_deviations}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
