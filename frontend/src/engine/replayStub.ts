/**
 * Compact HH header for profile DB / Trainer table:
 * table line, seats+stacks, blinds, dealt cards — no full streets.
 */

import type { ParsedSeat } from "./types";

export function extractReplayStub(raw: string): string {
  const text = (raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const out: string[] = [];
  let seenHole = false;

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;

    if (/^(?:PokerStars(?: Zoom)? Hand|Poker Hand) #/i.test(t)) {
      out.push(t);
      continue;
    }
    if (/^Table '/i.test(t)) {
      out.push(t);
      continue;
    }
    if (/^Seat \d+:/i.test(t)) {
      out.push(t);
      continue;
    }
    if (/:\s*posts\s+(?:the ante|small blind|big blind)\b/i.test(t)) {
      out.push(t);
      continue;
    }
    if (/^\*\*\*\s+HOLE CARDS\s+\*\*\*/i.test(t)) {
      out.push(t);
      seenHole = true;
      continue;
    }
    if (seenHole && /^Dealt to /i.test(t)) {
      out.push(t);
      break;
    }
    if (/^\*\*\*\s+(FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*/i.test(t)) {
      break;
    }
  }

  return out.join("\n");
}

/** Build a stub when full HH is missing but seat roster was parsed into IndexedDB. */
export function buildReplayStub(opts: {
  external_hand_id?: string | null;
  table_name?: string | null;
  table_max?: number | null;
  button_seat?: number | null;
  small_blind?: number | null;
  big_blind?: number | null;
  played_at?: string | null;
  seats: ParsedSeat[];
  hero_name?: string | null;
  hero_hand?: string | null;
}): string {
  if (!opts.seats?.length) return "";

  const sb = opts.small_blind ?? 0.5;
  const bb = opts.big_blind ?? 1;
  const max = opts.table_max || opts.seats.length || 6;
  const button = opts.button_seat || 1;
  const table = (opts.table_name || "Table").replace(/'/g, "");
  const hid = (opts.external_hand_id || "0").replace(/\s+/g, "");
  const when = (opts.played_at || "2024/01/01 12:00:00").replace("T", " ").replace("Z", "");
  const datePart = when.includes("/")
    ? when.slice(0, 19)
    : when.replace(/-/g, "/").slice(0, 19);

  const lines: string[] = [
    `Poker Hand #${hid}: Hold'em No Limit ($${sb}/$${bb}) - ${datePart}`,
    `Table '${table}' ${max}-max Seat #${button} is the button`,
  ];

  for (const s of [...opts.seats].sort((a, b) => a.seat - b.seat)) {
    const stack = Number.isFinite(s.stack) ? s.stack : 100;
    lines.push(`Seat ${s.seat}: ${s.name} ($${stack} in chips)`);
  }

  lines.push("*** HOLE CARDS ***");
  const hero = opts.hero_name || "Hero";
  if (opts.hero_hand && opts.hero_hand.length >= 4) {
    const c1 = opts.hero_hand.slice(0, 2);
    const c2 = opts.hero_hand.slice(2, 4);
    lines.push(`Dealt to ${hero} [${c1} ${c2}]`);
  } else {
    lines.push(`Dealt to ${hero}`);
  }

  return lines.join("\n");
}

/** Prefer HH header extract; fall back to structured seats. */
export function replayStubForUpload(opts: {
  raw_text?: string | null;
  external_hand_id?: string | null;
  table_name?: string | null;
  table_max?: number | null;
  button_seat?: number | null;
  small_blind?: number | null;
  big_blind?: number | null;
  played_at?: string | null;
  seats?: ParsedSeat[] | null;
  hero_name?: string | null;
  hero_hand?: string | null;
}): string {
  const fromRaw = extractReplayStub(opts.raw_text || "");
  if (fromRaw.includes("Seat ")) return fromRaw;
  return buildReplayStub({
    external_hand_id: opts.external_hand_id,
    table_name: opts.table_name,
    table_max: opts.table_max,
    button_seat: opts.button_seat,
    small_blind: opts.small_blind,
    big_blind: opts.big_blind,
    played_at: opts.played_at,
    seats: opts.seats || [],
    hero_name: opts.hero_name,
    hero_hand: opts.hero_hand,
  });
}
