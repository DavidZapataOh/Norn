/** Authored on one 1.5px stroke grid at 20x20. No glyph or emoji substitutes. */

type IconProps = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function Check({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

export function Diamond({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 3.5 16.5 10 10 16.5 3.5 10Z" />
    </svg>
  );
}

export function Slash({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M5.6 14.4 14.4 5.6" />
    </svg>
  );
}

export function Crosshair({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1" />
      <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" />
    </svg>
  );
}

export function Seal({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="10" cy="8" r="4.5" />
      <path d="M7 12.2 6 18l4-2 4 2-1-5.8" />
    </svg>
  );
}

export function Repeat({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 8.5a6.5 6.5 0 0 1 11-3.4L17 7.5" />
      <path d="M17 3v4.5h-4.5" />
      <path d="M16.5 11.5a6.5 6.5 0 0 1-11 3.4L3 12.5" />
      <path d="M3 17v-4.5h4.5" />
    </svg>
  );
}

export function Arrow({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

export function GitHub({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 .6a9.4 9.4 0 0 0-3 18.3c.5.1.6-.2.6-.4v-1.7c-2.4.5-3-.6-3.2-1.2-.1-.3-.6-1.2-1.1-1.4-.4-.2-.9-.7 0-.7.7 0 1.3.7 1.5 1 .8 1.5 2.2 1 2.8.8.1-.6.4-1 .7-1.3-2.2-.2-4.4-1.1-4.4-4.8 0-1 .4-1.9 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9 9 0 0 1 4.8 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.6 0 3.7-2.2 4.6-4.4 4.8.4.3.7.9.7 1.9v2.8c0 .2.1.5.6.4A9.4 9.4 0 0 0 10 .6Z" />
    </svg>
  );
}

export const propertyIcons = {
  crosshair: Crosshair,
  diamond: Diamond,
  seal: Seal,
  repeat: Repeat,
} as const;
