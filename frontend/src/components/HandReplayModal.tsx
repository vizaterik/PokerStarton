import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createHandShare,
  createHandShareFromReplay,
  fetchHandReplay,
  fetchPublicHandReplay,
  fetchResultsHuPotHands,
  fetchStatHands,
  fetchStrategyHuPotHands,
  type StatHandsResponse,
} from "../api/client";
import {
  fetchLocalHandReplay,
  fetchLocalStatHands,
  isLocalHandId,
} from "../engine/localReplay";

const SERVER_HAND_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isServerHandId(id: string | null | undefined): boolean {
  return Boolean(id && SERVER_HAND_UUID_RE.test(id));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
import { peekAnalysisCache } from "../lib/analysisCache";
import { formatHandHistoryText } from "../lib/formatHandHistory";
import PokerTable, { formatAmount, type AmountUnit } from "./PokerTable";

const AMOUNT_UNIT_KEY = "pokerledger.replay.amountUnit";

function readAmountUnit(): AmountUnit {
  try {
    const v = localStorage.getItem(AMOUNT_UNIT_KEY);
    if (v === "bb" || v === "money") return v;
  } catch {
    /* ignore */
  }
  return "bb";
}

export type HuPotReplayQuery = {
  potKind: string;
  matchup: string;
  source: "strategy" | "results";
  sessionId?: string;
  dateFrom?: string;
  dateTo?: string;
};

type Props = {
  open: boolean;
  /** Required unless viewing a public share token or results HU pot */
  strategyId?: string;
  stat?: string;
  label: string;
  handId?: string | null;
  /** Browse a list of hands (e.g. all preflop errors) with prev/next */
  handIds?: string[] | null;
  /** Start index within handIds */
  initialHandIndex?: number;
  /** Public share token — loads /api/public/hands/{token}/replay */
  publicToken?: string | null;
  /** HU pot branch hands (pot_kind + matchup) */
  huPot?: HuPotReplayQuery | null;
  /** Embed as page (no close / no share create) */
  pageMode?: boolean;
  onClose: () => void;
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HandReplayModal({
  open,
  strategyId = "",
  stat = "vpip",
  label,
  handId = null,
  handIds = null,
  initialHandIndex = 0,
  publicToken = null,
  huPot = null,
  pageMode = false,
  onClose,
}: Props) {
  const [data, setData] = useState<StatHandsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [handIdx, setHandIdx] = useState(0);
  const [actionIdx, setActionIdx] = useState(-1);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [shareState, setShareState] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const [amountUnit, setAmountUnit] = useState<AmountUnit>(readAmountUnit);
  const logListRef = useRef<HTMLOListElement | null>(null);
  const listIds = handIds?.filter(Boolean) ?? [];
  const handIdsKey = listIds.join(",");
  const singleHand =
    Boolean(publicToken) ||
    (listIds.length === 0 && Boolean(handId)) ||
    listIds.length === 1;
  const canShare = !publicToken && !pageMode;

  const setUnit = useCallback((unit: AmountUnit) => {
    setAmountUnit(unit);
    try {
      localStorage.setItem(AMOUNT_UNIT_KEY, unit);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setActionIdx(-1);
    setCopyState("idle");
    setShareState("idle");
    setShareError(null);
    setShareUrl(null);

    const ids = handIdsKey ? handIdsKey.split(",") : [];
    const wrapHands = (
      hands: Awaited<ReturnType<typeof fetchHandReplay>>[],
    ): StatHandsResponse => ({
      strategy_id: strategyId || "shared",
      stat: ids.length > 1 ? "errors" : "hand",
      label,
      total_matched: hands.length,
      hands,
    });

    const startIdx =
      ids.length > 0 ? Math.max(0, Math.min(ids.length - 1, initialHandIndex)) : 0;
    setHandIdx(huPot ? 0 : startIdx);

    const localAnalysis = Boolean(
      strategyId && peekAnalysisCache(strategyId)?.fingerprint?.startsWith("local:"),
    );

    let load: Promise<StatHandsResponse>;
    if (huPot) {
      load =
        huPot.source === "results"
          ? fetchResultsHuPotHands({
              potKind: huPot.potKind,
              matchup: huPot.matchup,
              sessionId: huPot.sessionId,
              dateFrom: huPot.dateFrom,
              dateTo: huPot.dateTo,
            })
          : fetchStrategyHuPotHands(strategyId, huPot.potKind, huPot.matchup);
    } else if (publicToken) {
      load = fetchPublicHandReplay(publicToken).then((hand) => wrapHands([hand]));
    } else if (ids.length > 0 && ids.every(isLocalHandId)) {
      load = Promise.all(ids.map((id) => fetchLocalHandReplay(id))).then(wrapHands);
    } else if (handId && isLocalHandId(handId)) {
      load = fetchLocalHandReplay(handId).then((hand) => wrapHands([hand]));
    } else if (ids.length > 0) {
      load = Promise.all(ids.map((id) => fetchHandReplay(strategyId, id))).then(wrapHands);
    } else if (handId) {
      load = fetchHandReplay(strategyId, handId).then((hand) => wrapHands([hand]));
    } else if (localAnalysis) {
      load = fetchLocalStatHands(strategyId, stat);
    } else {
      load = fetchStatHands(strategyId, stat);
    }

    void load
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить раздачи");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    strategyId,
    stat,
    handId,
    handIdsKey,
    initialHandIndex,
    label,
    publicToken,
    huPot?.source,
    huPot?.potKind,
    huPot?.matchup,
    huPot?.sessionId,
    huPot?.dateFrom,
    huPot?.dateTo,
  ]);

  const hand = data?.hands[handIdx] ?? null;
  const maxAction = hand ? hand.actions.length - 1 : -1;
  const handsCount = data?.hands.length ?? 0;

  const canNextStep = hand != null && actionIdx < maxAction;
  const canPrevStep = hand != null && actionIdx > -1;
  const canPrevHand = !singleHand && handIdx > 0;
  const canNextHand = !singleHand && data != null && handIdx < data.hands.length - 1;

  const goNextStep = useCallback(() => {
    if (!hand) return;
    if (actionIdx < maxAction) setActionIdx((i) => i + 1);
  }, [actionIdx, hand, maxAction]);

  const goPrevStep = useCallback(() => {
    if (!hand) return;
    if (actionIdx > -1) setActionIdx((i) => i - 1);
  }, [actionIdx, hand]);

  const goStart = useCallback(() => {
    setActionIdx(-1);
  }, []);

  const goEnd = useCallback(() => {
    if (maxAction >= 0) setActionIdx(maxAction);
  }, [maxAction]);

  const goPrevHand = useCallback(() => {
    if (!canPrevHand) return;
    setHandIdx((i) => i - 1);
    setActionIdx(-1);
  }, [canPrevHand]);

  const goNextHand = useCallback(() => {
    if (!canNextHand) return;
    setHandIdx((i) => i + 1);
    setActionIdx(-1);
  }, [canNextHand]);

  const jumpToHand = useCallback(
    (index: number) => {
      if (!data || singleHand) return;
      const next = Math.max(0, Math.min(data.hands.length - 1, index));
      setHandIdx(next);
      setActionIdx(-1);
    },
    [data, singleHand],
  );

  useEffect(() => {
    setActionIdx(-1);
    setCopyState("idle");
    setShareUrl(null);
    setShareError(null);
    setShareState("idle");
  }, [handIdx]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    if (!pageMode) {
      document.body.style.overflow = "hidden";
      document.body.classList.add("confirm-open");
    }
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (!pageMode) onClose();
        return;
      }
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        goNextStep();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevStep();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goNextHand();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrevHand();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("confirm-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pageMode, onClose, goNextStep, goPrevStep, goNextHand, goPrevHand]);

  const actionLog = useMemo(() => {
    if (!hand) return [];
    return hand.actions.slice(0, Math.max(0, actionIdx + 1));
  }, [hand, actionIdx]);

  useEffect(() => {
    const el = logListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [actionIdx, handIdx]);

  async function copyHistory() {
    if (!hand) return;
    try {
      await navigator.clipboard.writeText(formatHandHistoryText(hand));
      setCopyState("ok");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("fail");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  async function copyShareLink() {
    if (!hand) return;
    setShareState("loading");
    setShareError(null);
    setShareUrl(null);
    try {
      if (!hand.actions?.length) {
        throw new Error("В раздаче нет действий — выберите другую руку");
      }
      const id = hand.id ?? handId;
      const raw = (hand.raw_text || "").trim() || formatHandHistoryText(hand);
      let share;
      if (isServerHandId(id) && !isLocalHandId(id)) {
        try {
          share = await createHandShare(id);
        } catch {
          share = await createHandShareFromReplay({ ...hand, raw_text: raw });
        }
      } else {
        share = await createHandShareFromReplay({ ...hand, raw_text: raw });
      }
      const path = share.path.startsWith("/") ? share.path : `/${share.path}`;
      const url = `${window.location.origin}${path}`;
      setShareUrl(url);
      const copied = await copyText(url);
      if (!copied) {
        setShareError("Ссылка создана — скопируйте вручную ниже");
        setShareState("ok");
        return;
      }
      setShareState("ok");
      window.setTimeout(() => setShareState("idle"), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось создать ссылку";
      setShareError(msg);
      setShareState("fail");
      window.setTimeout(() => setShareState("idle"), 4000);
    }
  }

  if (!open) return null;

  const progress =
    maxAction < 0 ? 0 : Math.min(100, ((actionIdx + 1) / (maxAction + 1)) * 100);

  const shell = (
      <div
        className={`pr-shell${logOpen ? "" : " log-collapsed"}${pageMode ? " is-page" : ""}`}
        role={pageMode ? "region" : "dialog"}
        aria-modal={pageMode ? undefined : true}
        aria-label={`Hand Replayer · ${label}`}
        onClick={pageMode ? undefined : (e) => e.stopPropagation()}
      >
        <header className="pr-topbar">
          <div className="pr-topbar-left">
            <span className="pr-kicker">{label}</span>
            <h2>
              {loading
                ? "Loading…"
                : data
                  ? singleHand
                    ? "Hand Replay"
                    : `${data.total_matched} hands`
                  : "Hand Replay"}
            </h2>
          </div>
          <div className="pr-topbar-right">
            {canShare && hand ? (
              <button
                type="button"
                className="pr-ghost-btn pr-share-btn"
                disabled={shareState === "loading"}
                onClick={() => void copyShareLink()}
                title="Скопировать публичную ссылку на эту раздачу"
              >
                {shareState === "loading"
                  ? "…"
                  : shareState === "ok"
                    ? "Ссылка скопирована"
                    : shareState === "fail"
                      ? "Ошибка"
                      : "Поделиться"}
              </button>
            ) : null}
            {hand && (
              <button type="button" className="pr-ghost-btn" onClick={() => void copyHistory()}>
                {copyState === "ok" ? "Copied" : copyState === "fail" ? "Failed" : "Copy HH"}
              </button>
            )}
            <button
              type="button"
              className="pr-ghost-btn"
              onClick={() => setLogOpen((v) => !v)}
              aria-pressed={logOpen}
            >
              {logOpen ? "Hide log" : "Show log"}
            </button>
            {!pageMode ? (
              <button type="button" className="pr-icon-btn" onClick={onClose} aria-label="Close">
                ×
              </button>
            ) : null}
          </div>
        </header>

        {error && <p className="pr-error">{error}</p>}
        {shareError && <p className="pr-error">{shareError}</p>}
        {shareUrl && (
          <p className="pr-share-url">
            <a href={shareUrl} target="_blank" rel="noreferrer">
              {shareUrl}
            </a>
          </p>
        )}
        {loading && <p className="pr-muted">Loading hands…</p>}
        {!loading && data && data.hands.length === 0 && (
          <p className="pr-muted">No hands for «{label}».</p>
        )}


        {hand && (
          <>
            <div className="pr-main">
              <div className="pr-stage">
                <PokerTable hand={hand} actionIndex={actionIdx} amountUnit={amountUnit} />
              </div>

              <aside className="pr-log" aria-label="Action history">
                <div className="pr-log-head">
                  <span>Action Log</span>
                  <em>
                    {Math.max(0, actionIdx + 1)}/{Math.max(0, maxAction + 1)}
                  </em>
                </div>
                <ol className="pr-log-list" ref={logListRef}>
                  {actionLog.length === 0 && (
                    <li className="pr-log-empty">Cards dealt — press Next</li>
                  )}
                  {actionLog.map((a, i) => {
                    const current = i === actionLog.length - 1;
                    return (
                      <li
                        key={`${a.order}-${a.player_name}`}
                        className={[
                          "pr-log-row",
                          a.is_hero ? "hero" : "",
                          current ? "current" : "",
                          a.action,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="pr-log-street">{a.street}</span>
                        <span className="pr-log-name">{a.player_name}</span>
                        <span className="pr-log-act">
                          {a.action}
                          {a.amount != null
                            ? ` ${formatAmount(a.amount, amountUnit, hand.big_blind)}`
                            : ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </aside>
            </div>

            <footer className="pr-controls">
              <div className="pr-controls-info">
                <span title={hand.external_hand_id}>#{hand.external_hand_id}</span>
                <span>
                  {hand.small_blind != null && hand.big_blind != null
                    ? `$${hand.small_blind}/$${hand.big_blind}`
                    : "—"}
                </span>
                <span>{formatWhen(hand.played_at)}</span>
                <div
                  className="pr-unit-toggle"
                  role="group"
                  aria-label="Единицы ставок"
                >
                  <button
                    type="button"
                    className={amountUnit === "money" ? "active" : ""}
                    onClick={() => setUnit("money")}
                    title="Доллары"
                  >
                    $
                  </button>
                  <button
                    type="button"
                    className={amountUnit === "bb" ? "active" : ""}
                    disabled={hand.big_blind == null || hand.big_blind <= 0}
                    onClick={() => setUnit("bb")}
                    title="Большие блайнды"
                  >
                    BB
                  </button>
                </div>
              </div>

              <div className="pr-controls-media">
                <button
                  type="button"
                  className="pr-media-btn"
                  disabled={!hand}
                  onClick={goStart}
                  title="В начало раздачи"
                  aria-label="В начало раздачи"
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className="pr-media-btn"
                  disabled={!canPrevStep}
                  onClick={goPrevStep}
                  title="Шаг назад"
                  aria-label="Шаг назад"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="pr-media-btn"
                  disabled={!canNextStep}
                  onClick={goNextStep}
                  title="Шаг вперёд"
                  aria-label="Шаг вперёд"
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="pr-media-btn"
                  disabled={maxAction < 0 || actionIdx >= maxAction}
                  onClick={goEnd}
                  title="В конец раздачи"
                  aria-label="В конец раздачи"
                >
                  ⏭
                </button>
              </div>

              <div className="pr-controls-hands">
                {!singleHand && (
                  <>
                    <button
                      type="button"
                      className="pr-hand-btn"
                      disabled={!canPrevHand}
                      onClick={goPrevHand}
                    >
                      Пред. рука
                    </button>
                    <label className="pr-hand-jump">
                      <span>Рука</span>
                      <select
                        value={handIdx}
                        onChange={(e) => jumpToHand(Number(e.target.value))}
                        aria-label="Выбор раздачи"
                      >
                        {Array.from({ length: handsCount }, (_, i) => (
                          <option key={i} value={i}>
                            {i + 1} / {handsCount}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="pr-hand-btn"
                      disabled={!canNextHand}
                      onClick={goNextHand}
                    >
                      След. рука
                    </button>
                  </>
                )}
                {canShare ? (
                  <button
                    type="button"
                    className="pr-hand-btn pr-share-btn"
                    disabled={shareState === "loading"}
                    onClick={() => void copyShareLink()}
                    title="Скопировать публичную ссылку"
                  >
                    {shareState === "loading"
                      ? "…"
                      : shareState === "ok"
                        ? "Ссылка скопирована"
                        : shareState === "fail"
                          ? "Ошибка шаринга"
                          : "Поделиться раздачей"}
                  </button>
                ) : null}
                <span className="pr-controls-step">
                  Шаг {Math.max(0, actionIdx + 1)}/{Math.max(0, maxAction + 1)}
                </span>
              </div>

              <div className="pr-controls-track" aria-hidden>
                <i style={{ width: `${progress}%` }} />
              </div>
            </footer>
          </>
        )}
      </div>
  );

  if (pageMode) {
    return <div className="pr-page">{shell}</div>;
  }

  return createPortal(
    <div className="pr-backdrop" role="presentation" onClick={onClose}>
      {shell}
    </div>,
    document.body,
  );
}
