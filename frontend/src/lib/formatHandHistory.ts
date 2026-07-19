import type { ReplayHand } from "../api/client";

/** Prefer original HH text; otherwise build a readable transcript. */
export function formatHandHistoryText(hand: ReplayHand): string {
  const raw = (hand.raw_text || "").trim();
  if (raw.length > 40) return raw.replace(/\r\n/g, "\n");

  const lines: string[] = [];
  const stakes =
    hand.small_blind != null && hand.big_blind != null
      ? `$${hand.small_blind}/$${hand.big_blind}`
      : "—";
  lines.push(`Hand #${hand.external_hand_id} · ${stakes}`);
  if (hand.table_name) lines.push(`Table '${hand.table_name}'`);
  if (hand.played_at) lines.push(hand.played_at);
  lines.push("");

  for (const s of hand.seats) {
    const tag = [
      s.position,
      s.is_button ? "BTN" : null,
      s.is_hero ? "Hero" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const stack = s.stack != null ? ` ($${s.stack.toFixed(2)})` : "";
    lines.push(`Seat ${s.seat}: ${s.name}${stack}${tag ? ` — ${tag}` : ""}`);
  }

  if (hand.hero_cards.length === 2) {
    lines.push("");
    lines.push(`Dealt to Hero [${hand.hero_cards.join(" ")}]`);
  }

  let street = "";
  for (const a of hand.actions) {
    if (a.street !== street) {
      street = a.street;
      lines.push("");
      if (street === "flop" && hand.board.length >= 3) {
        lines.push(`*** FLOP *** [${hand.board.slice(0, 3).join(" ")}]`);
      } else if (street === "turn" && hand.board.length >= 4) {
        lines.push(`*** TURN *** [${hand.board.slice(0, 3).join(" ")}] [${hand.board[3]}]`);
      } else if (street === "river" && hand.board.length >= 5) {
        lines.push(
          `*** RIVER *** [${hand.board.slice(0, 4).join(" ")}] [${hand.board[4]}]`,
        );
      } else if (street === "preflop") {
        lines.push("*** HOLE CARDS ***");
      } else {
        lines.push(`*** ${street.toUpperCase()} ***`);
      }
    }
    const amt = a.amount != null ? ` ${a.amount}` : "";
    const verb =
      a.action === "call" && (a.amount == null || a.amount === 0) ? "checks" : `${a.action}s${amt}`;
    lines.push(`${a.player_name}: ${verb}`);
  }

  lines.push("");
  lines.push(
    `Hero result: ${hand.hero_net >= 0 ? "+" : ""}${hand.hero_net.toFixed(2)} ` +
      `(${hand.hero_net_bb >= 0 ? "+" : ""}${hand.hero_net_bb.toFixed(2)} bb)`,
  );
  return lines.join("\n");
}
