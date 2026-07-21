import { useId, type CSSProperties } from "react";

/**
 * Original PokerStraton mark: strategy chart matrix + decision path.
 * Not a stock chip/spade — reads as “ranges / GTO line”.
 */
export default function BrandMark({
  className = "",
  hero = false,
}: {
  className?: string;
  /** Large animated mark for the home hero visual */
  hero?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const glow = `bm-glow-${uid}`;
  const ink = `bm-ink-${uid}`;

  return (
    <span
      className={`brand-mark${hero ? " brand-mark--hero" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      <svg className="brand-mark__svg" viewBox="0 0 32 32" fill="none">
        <defs>
          <linearGradient id={ink} x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
            <stop stopColor="#181c1a" />
            <stop offset="1" stopColor="#0a0c0b" />
          </linearGradient>
          <linearGradient id={glow} x1="8" y1="8" x2="26" y2="26" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9dffb0" />
            <stop offset="1" stopColor="#3ecf6a" />
          </linearGradient>
        </defs>

        <rect
          className="brand-mark__tile"
          x="1.75"
          y="1.75"
          width="28.5"
          height="28.5"
          rx="7.5"
          fill={`url(#${ink})`}
        />
        <rect
          className="brand-mark__frame"
          x="1.75"
          y="1.75"
          width="28.5"
          height="28.5"
          rx="7.5"
          stroke={hero ? "rgba(160,230,175,0.55)" : "rgba(136,249,145,0.28)"}
          strokeWidth={hero ? 0.85 : 1}
          fill="none"
        />

        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3].map((col) => {
            const x = 6.35 + col * 5.05;
            const y = 6.35 + row * 5.05;
            const raise = (row === 0 && col <= 1) || (row === 1 && col === 0);
            const call = (row === 1 && col === 1) || (row === 2 && col === 1);
            const fill = raise
              ? "rgba(239,68,68,0.62)"
              : call
                ? "rgba(34,197,94,0.45)"
                : "rgba(255,255,255,0.07)";
            const tone = raise ? "raise" : call ? "call" : "fold";
            const delay = row * 4 + col;
            return (
              <rect
                key={`${row}-${col}`}
                className={`brand-mark__cell brand-mark__cell--${tone}`}
                style={hero ? ({ "--bm-i": delay } as CSSProperties) : undefined}
                x={x}
                y={y}
                width="4.2"
                height="4.2"
                rx="0.7"
                fill={fill}
                stroke={hero ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)"}
                strokeWidth={hero ? 0.32 : 0.4}
              />
            );
          }),
        )}

        <path
          className="brand-mark__path"
          d="M8.5 24.2 L13.15 19.55 L18.05 19.55 L22.7 14.9 L22.7 9.1"
          stroke={`url(#${glow})`}
          strokeWidth={hero ? 1.45 : 1.85}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          pathLength={100}
        />
        <circle
          className="brand-mark__node"
          cx="22.7"
          cy="9.1"
          r={hero ? 1.75 : 2.15}
          fill={`url(#${glow})`}
        />
        <circle
          className="brand-mark__node-core"
          cx="22.7"
          cy="9.1"
          r={hero ? 0.65 : 0.85}
          fill="#0a0c0b"
        />
      </svg>
    </span>
  );
}
