import type { CurvePoint, ResultsReport, SessionProfitRow } from "../api/client";

function inPeriod(
  playedAt: string | null | undefined,
  dateFrom?: string,
  dateTo?: string,
): boolean {
  if (!dateFrom && !dateTo) return true;
  if (!playedAt) return false;
  // ISO wall-clock strings from the API compare lexicographically.
  if (dateFrom && playedAt < dateFrom) return false;
  if (dateTo && playedAt > dateTo) return false;
  return true;
}

/**
 * Derive a period/session slice from an already-loaded all-time results report.
 * Avoids re-fetching / re-computing on the server when the user switches chips.
 */
export function filterResultsReport(
  all: ResultsReport,
  opts: { sessionId?: string; dateFrom?: string; dateTo?: string },
): ResultsReport {
  const sessionId = opts.sessionId || "";
  const dateFrom = opts.dateFrom;
  const dateTo = opts.dateTo;

  if (!sessionId && !dateFrom && !dateTo) return all;

  const points = all.curve.filter((p) => {
    if (sessionId && p.session_id !== sessionId) return false;
    return inPeriod(p.played_at, dateFrom, dateTo);
  });

  let cumBb = 0;
  let cumMoney = 0;
  let cumWsdBb = 0;
  let cumWwsdBb = 0;
  let cumWsdM = 0;
  let cumWwsdM = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;

  const curve: CurvePoint[] = points.map((p, idx) => {
    const handBb = Number(p.hand_bb) || 0;
    const handMoney = Number(p.hand_money) || 0;
    cumBb += handBb;
    cumMoney += handMoney;
    // Per-hand wsd/wwsd deltas are not stored — keep cumulatives flat for filtered view.
    if (handBb > 0.001) wins += 1;
    else if (handBb < -0.001) losses += 1;
    else scratches += 1;
    return {
      ...p,
      hand_index: idx + 1,
      cum_bb: Math.round(cumBb * 10000) / 10000,
      cum_money: Math.round(cumMoney * 10000) / 10000,
      cum_wsd_bb: cumWsdBb,
      cum_wwsd_bb: cumWwsdBb,
      cum_wsd_money: cumWsdM,
      cum_wwsd_money: cumWwsdM,
      hand_bb: handBb,
      hand_money: handMoney,
    };
  });

  const bySession = new Map<string, { hands: number; profitM: number; profitBb: number }>();
  for (const p of points) {
    const sid = p.session_id;
    if (!sid) continue;
    const row = bySession.get(sid) || { hands: 0, profitM: 0, profitBb: 0 };
    row.hands += 1;
    row.profitM += Number(p.hand_money) || 0;
    row.profitBb += Number(p.hand_bb) || 0;
    bySession.set(sid, row);
  }

  const sessions: SessionProfitRow[] = all.sessions
    .map((s) => {
      const agg = bySession.get(s.id);
      if (!agg) return null;
      return {
        ...s,
        hands_count: agg.hands,
        profit_money: Math.round(agg.profitM * 100) / 100,
        profit_bb: Math.round(agg.profitBb * 100) / 100,
        winrate_bb100:
          agg.hands > 0 ? Math.round((agg.profitBb / agg.hands) * 10000) / 100 : 0,
      };
    })
    .filter((s): s is SessionProfitRow => s != null);

  const n = curve.length;
  return {
    ...all,
    total_hands: n,
    total_profit_money: Math.round(cumMoney * 100) / 100,
    total_profit_bb: Math.round(cumBb * 100) / 100,
    winrate_bb100: n > 0 ? Math.round((cumBb / n) * 10000) / 100 : 0,
    wins,
    losses,
    scratches,
    sessions_count: sessions.length,
    has_any_data: all.has_any_data,
    date_from: dateFrom ?? null,
    date_to: dateTo ?? null,
    curve,
    sessions,
    // Branch tops need per-hand tags — omit on client filter.
    top_losing_branches: [],
    top_profitable_branches: [],
  };
}
