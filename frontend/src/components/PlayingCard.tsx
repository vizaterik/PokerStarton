type Props = {
  code: string;
  size?: "sm" | "md" | "lg";
};

const SUIT_GLYPH: Record<string, string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

const SUIT_CLASS: Record<string, string> = {
  s: "suit-s",
  h: "suit-h",
  d: "suit-d",
  c: "suit-c",
};

export default function PlayingCard({ code, size = "md" }: Props) {
  const rank = (code[0] || "?").toUpperCase();
  const suitKey = (code[1] || "").toLowerCase();
  const suit = SUIT_GLYPH[suitKey] || suitKey;
  const suitClass = SUIT_CLASS[suitKey] || "suit-s";

  return (
    <span className={`pr-card ${size} ${suitClass}`} title={code.toUpperCase()}>
      <span className="pr-card-rank">{rank}</span>
      <span className="pr-card-suit">{suit}</span>
    </span>
  );
}

export function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`pr-card back ${size}`} aria-hidden>
      <span className="pr-card-back-pattern" />
    </span>
  );
}
