/** Professional line icons for topbar navigation. */
import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function NavSvg({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className ?? "nav-icon"}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Academy — graduation cap */
export function IconAcademy({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <path {...stroke} d="M3 9.5 12 5l9 4.5-9 4.5L3 9.5Z" />
      <path {...stroke} d="M7 12.2v4.3c0 .8 2.2 2 5 2s5-1.2 5-2v-4.3" />
      <path {...stroke} d="M21 10v5.5" />
    </NavSvg>
  );
}

/** Strategies — range matrix */
export function IconStrategies({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <rect {...stroke} x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path {...stroke} d="M3.5 9.5h17M3.5 15.5h17M9.5 3.5v17M15.5 3.5v17" />
    </NavSvg>
  );
}

/** Trainer — target */
export function IconTrainer({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <circle {...stroke} cx="12" cy="12" r="8" />
      <circle {...stroke} cx="12" cy="12" r="4.75" />
      <circle {...stroke} cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
    </NavSvg>
  );
}

/** Analysis — bar chart */
export function IconAnalysis({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <path {...stroke} d="M4 19V5" />
      <path {...stroke} d="M4 19h16" />
      <path {...stroke} d="M8 16V11" />
      <path {...stroke} d="M12 16V7.5" />
      <path {...stroke} d="M16 16v-5.5" />
    </NavSvg>
  );
}

/** Career — rising path */
export function IconCareer({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <path {...stroke} d="M4 17h16" />
      <path {...stroke} d="M5 14l4-4 3.5 3L19 7" />
      <path {...stroke} d="M15 7h4v4" />
    </NavSvg>
  );
}

/** Hits / Feed — spark */
export function IconHits({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <path
        {...stroke}
        d="M13 3 6.5 12.5h4.2L9.2 21 18 9.8h-4.4L13 3Z"
      />
    </NavSvg>
  );
}

/** Admin — shield */
export function IconAdmin({ className }: IconProps) {
  return (
    <NavSvg className={className}>
      <path
        {...stroke}
        d="M12 3 5 6.2v5.3c0 4.2 2.9 7.2 7 8.5 4.1-1.3 7-4.3 7-8.5V6.2L12 3Z"
      />
      <path {...stroke} d="M9.5 12.2 11.2 14l3.5-3.8" />
    </NavSvg>
  );
}
