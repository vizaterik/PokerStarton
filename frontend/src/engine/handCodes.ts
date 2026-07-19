const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const RANK_INDEX: Record<string, number> = Object.fromEntries(
  RANKS.map((r, i) => [r, i]),
);

export function cardsToHandCode(card1: string, card2: string): string {
  const c1 = card1.trim();
  const c2 = card2.trim();
  if (c1.length < 2 || c2.length < 2) throw new Error(`Invalid cards: ${card1}, ${card2}`);
  let r1 = c1[0].toUpperCase();
  let s1 = c1[1].toLowerCase();
  let r2 = c2[0].toUpperCase();
  let s2 = c2[1].toLowerCase();
  if (!(r1 in RANK_INDEX) || !(r2 in RANK_INDEX)) {
    throw new Error(`Invalid ranks: ${card1}, ${card2}`);
  }
  if (r1 === r2) return `${r1}${r2}`;
  if (RANK_INDEX[r1] > RANK_INDEX[r2]) {
    [r1, r2, s1, s2] = [r2, r1, s2, s1];
  }
  return `${r1}${r2}${s1 === s2 ? "s" : "o"}`;
}
