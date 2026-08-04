/**
 * Іконки — власні inline SVG, без бібліотеки.
 *
 * Причина проста: їх тут два десятки, а будь-який icon-pack тягне за собою
 * або весь набір у бандл, або окремий крок збірки. Inline SVG важить байти,
 * фарбується через currentColor і не має шансу «не завантажитись» на
 * GitHub Pages.
 *
 * Усі іконки малюються в сітці 24×24 і успадковують колір тексту, тому
 * достатньо поставити color на батьківському елементі.
 */
import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
}

function svg(path: React.ReactNode, { size = 18, color, style }: IconProps, filled = false) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, flexShrink: 0, verticalAlign: 'middle', ...style }}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

/* ─────────────────────────  зірки  ───────────────────────── */

const STAR_D =
  'M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95L12 2.6z';

export const StarFull = (p: IconProps) => svg(<path d={STAR_D} />, p, true);

export const StarEmpty = (p: IconProps) => svg(<path d={STAR_D} />, { ...p });

/** Половина зірки: суцільна ліва частина + контур цілої. */
export function StarHalf({ size = 18, color, style }: IconProps) {
  const id = `half-${Math.round(Math.random() * 1e9)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color, flexShrink: 0, verticalAlign: 'middle', ...style }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id}>
          <stop offset="50%" stopColor="currentColor" />
          <stop offset="50%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={STAR_D} fill={`url(#${id})`} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

/* ─────────────────────────  контакти  ───────────────────────── */

export const Globe = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </>,
    p,
  );

export const MapPin = (p: IconProps) =>
  svg(
    <>
      <path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </>,
    p,
  );

export const Phone = (p: IconProps) =>
  svg(
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
    p,
  );

export const Mail = (p: IconProps) =>
  svg(
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </>,
    p,
  );

/* ─────────────────────────  стан і метрики  ───────────────────────── */

export const AlertTriangle = (p: IconProps) =>
  svg(
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>,
    p,
  );

export const ShieldOff = (p: IconProps) =>
  svg(
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m4 4 16 16" />
    </>,
    p,
  );

export const Smartphone = (p: IconProps) =>
  svg(
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </>,
    p,
  );

export const Gauge = (p: IconProps) =>
  svg(
    <>
      <path d="M3.5 18a9 9 0 1 1 17 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="15" r="1.4" />
    </>,
    p,
  );

export const Clock = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
    p,
  );

export const Layers = (p: IconProps) =>
  svg(
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>,
    p,
  );

export const Tag = (p: IconProps) =>
  svg(
    <>
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
    </>,
    p,
  );

export const Users = (p: IconProps) =>
  svg(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
    </>,
    p,
  );

export const Target = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </>,
    p,
  );

export const Search = (p: IconProps) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    p,
  );

export const ChevronDown = (p: IconProps) => svg(<path d="m6 9 6 6 6-6" />, p);

export const ExternalLink = (p: IconProps) =>
  svg(
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>,
    p,
  );

export const Refresh = (p: IconProps) =>
  svg(
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </>,
    p,
  );

export const Logout = (p: IconProps) =>
  svg(
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>,
    p,
  );

export const Lock = (p: IconProps) =>
  svg(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>,
    p,
  );

export const Image = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>,
    p,
  );

/* ─────────────────────────  рейтинг у зірках  ───────────────────────── */

/**
 * Ряд зірок для складності 1-5 і для рейтингу Google (там бувають дробові).
 * Половинку малюємо тільки якщо залишок справді близький до 0.5 — інакше
 * 4.4 і 4.6 виглядали б однаково.
 */
export function Stars({
  value,
  size = 16,
  color = '#f59e0b',
  max = 5,
}: {
  value: number;
  size?: number;
  color?: string;
  max?: number;
}) {
  const full = Math.floor(value);
  const rest = value - full;
  const half = rest >= 0.25 && rest < 0.75;
  const fullCount = rest >= 0.75 ? full + 1 : full;

  return (
    <span style={{ display: 'inline-flex', gap: 1, color, lineHeight: 0 }}>
      {Array.from({ length: max }, (_, i) => {
        if (i < fullCount) return <StarFull key={i} size={size} />;
        if (i === fullCount && half) return <StarHalf key={i} size={size} />;
        return <StarEmpty key={i} size={size} style={{ opacity: 0.35 }} />;
      })}
    </span>
  );
}
