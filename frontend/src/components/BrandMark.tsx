/** PokerStraton mark — ace/chip, not a flat green square. */
export default function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <svg className="brand-mark__svg" viewBox="0 0 32 32" fill="none">
        <rect
          x="1.5"
          y="1.5"
          width="29"
          height="29"
          rx="8"
          fill="#141816"
          stroke="rgba(220, 230, 224, 0.22)"
          strokeWidth="1"
        />
        <path
          d="M16 6.2c2.8 3.4 6.8 6.2 6.8 10.1 0 3.2-2.4 5.5-6.8 9.5-4.4-4-6.8-6.3-6.8-9.5 0-3.9 4-6.7 6.8-10.1z"
          fill="#f2f5f3"
        />
        <circle cx="16" cy="14.2" r="1.35" fill="#141816" />
        <path
          d="M16 15.4v5.2M14.2 18.2h3.6"
          stroke="#141816"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
