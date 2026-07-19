import type { Seat, TableSize } from "./types";

/** GTO Wizard 6-max order */
export const SEATS_6: Seat[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
export const SEATS_8: Seat[] = ["UTG", "UTG1", "MP", "HJ", "CO", "BTN", "SB", "BB"];
export const SEATS_9: Seat[] = ["UTG", "UTG1", "MP", "MP1", "HJ", "CO", "BTN", "SB", "BB"];
export const SEATS_3: Seat[] = ["BTN", "SB", "BB"];
export const SEATS_2: Seat[] = ["BTN", "BB"];

export function seatsFor(tableSize: TableSize): Seat[] {
  if (tableSize === 9) return [...SEATS_9];
  if (tableSize === 8) return [...SEATS_8];
  if (tableSize === 3) return [...SEATS_3];
  if (tableSize === 2) return [...SEATS_2];
  return [...SEATS_6];
}

export function seatLabel(seat: Seat): string {
  if (seat === "UTG1") return "UTG+1";
  if (seat === "MP1") return "MP+1";
  if (seat === "MP") return "HJ"; // legacy alias display
  return seat;
}

/** Next live seat after `from`, skipping folded seats. */
export function nextSeat(
  tableSize: TableSize,
  from: Seat,
  folded: Set<Seat>,
): Seat | null {
  const order = seatsFor(tableSize);
  // Map legacy MP → HJ index for 6-max
  const normalized = from === "MP" && tableSize === 6 ? "HJ" : from;
  const start = order.indexOf(normalized);
  if (start < 0) return null;
  for (let i = 1; i <= order.length; i += 1) {
    const seat = order[(start + i) % order.length];
    if (!folded.has(seat) && !(seat === "HJ" && folded.has("MP"))) return seat;
  }
  return null;
}

export function liveSeats(tableSize: TableSize, folded: Set<Seat>): Seat[] {
  return seatsFor(tableSize).filter((s) => !folded.has(s));
}
