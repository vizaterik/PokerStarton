import { useId } from "react";

/** Poker room badge with hover glow — PS / GG. */

type Props = {
  room?: string | null;
  /** Full session label; leading "PS ·" / "GG ·" is stripped when rest is shown. */
  label?: string | null;
  showName?: boolean;
  className?: string;
};

function normalizeRoom(room?: string | null, label?: string | null): "pokerstars" | "ggpoker" {
  const r = (room || "").toLowerCase();
  if (r === "ggpoker" || r === "gg") return "ggpoker";
  if (r === "pokerstars" || r === "ps") return "pokerstars";
  if (label?.trim().toUpperCase().startsWith("GG")) return "ggpoker";
  return "pokerstars";
}

function restOfLabel(label: string | null | undefined): string {
  if (!label) return "";
  return label.replace(/^(PS|GG)\s*·\s*/i, "").trim();
}

function PsIcon({ gradId }: { gradId: string }) {
  return (
    <svg className="room-badge__svg" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={`${gradId}-red`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff4d4d" />
          <stop offset="55%" stopColor="#e11d2e" />
          <stop offset="100%" stopColor="#9b0f1a" />
        </linearGradient>
        <linearGradient id={`${gradId}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="7" fill={`url(#${gradId}-red)`} />
      <rect x="1" y="1" width="30" height="30" rx="7" fill={`url(#${gradId}-shine)`} />
      <path
        d="M16 5.2l1.55 4.55h4.8l-3.9 2.85 1.5 4.55L16 14.4l-3.95 2.75 1.5-4.55-3.9-2.85h4.8L16 5.2z"
        fill="#fff8e7"
        opacity="0.95"
      />
      <text
        x="16"
        y="25.2"
        textAnchor="middle"
        fill="#fff"
        fontFamily="Sora, system-ui, sans-serif"
        fontSize="9.5"
        fontWeight="800"
        letterSpacing="0.04em"
      >
        PS
      </text>
    </svg>
  );
}

function GgIcon({ gradId }: { gradId: string }) {
  return (
    <svg className="room-badge__svg" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={`${gradId}-amber`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6c453" />
          <stop offset="100%" stopColor="#d4a017" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill="#121212"
        stroke={`url(#${gradId}-amber)`}
        strokeWidth="1.5"
      />
      <text
        x="16"
        y="21.5"
        textAnchor="middle"
        fill={`url(#${gradId}-amber)`}
        fontFamily="Sora, system-ui, sans-serif"
        fontSize="11"
        fontWeight="800"
        letterSpacing="0.02em"
      >
        GG
      </text>
    </svg>
  );
}

export default function RoomBadge({
  room,
  label,
  showName = true,
  className = "",
}: Props) {
  const uid = useId().replace(/:/g, "");
  const kind = normalizeRoom(room, label);
  const isGG = kind === "ggpoker";
  const name = isGG ? "GGPoker" : "PokerStars";
  const rest = restOfLabel(label);

  return (
    <span className={`session-label ${className}`.trim()}>
      <span className={`room-badge room-badge--${isGG ? "gg" : "ps"}`} title={name}>
        <span className="room-badge__icon">
          {isGG ? <GgIcon gradId={`${uid}-gg`} /> : <PsIcon gradId={`${uid}-ps`} />}
        </span>
        {showName ? (
          <span className="room-badge__name">{isGG ? "GGPoker" : "PokerStars"}</span>
        ) : null}
      </span>
      {rest ? <span className="session-label__rest"> · {rest}</span> : null}
    </span>
  );
}
