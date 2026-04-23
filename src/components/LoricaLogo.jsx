import React from 'react';

/**
 * Lorica logo — 5 stacked rounded bars of identical size, arranged in
 * a zig-zag: left, centre, right, left, centre.
 *
 * All bars share the same width and height; only their horizontal
 * alignment alternates, creating a dynamic rhythm rather than a boring
 * monotone stack.
 *
 * Colours come from `--color-logo-{1..5}` CSS custom properties that
 * `App.jsx` sets whenever the active theme changes (see
 * `utils/themes.js::THEMES[theme].logoBars`). Each theme ships its own
 * 5-stop gradient so the logo tints with the UI — Spectre gets the
 * magenta-to-cyan brand palette, Hacker gets green, Forge gets orange,
 * etc.
 *
 * The same geometry is baked into `src-tauri/icons/logo.svg` for
 * OS-level icons which can't read theme vars.
 */
export default function LoricaLogo({ size = 32, className = '' }) {
  // Pattern: [cssVarIndex, alignment]
  // width/height are identical for every bar; only alignment changes.
  const bars = [
    [1, 'left'],
    [2, 'center'],
    [3, 'right'],
    [4, 'left'],
    [5, 'center'],
  ];

  const barH = 14;
  const barW = 80;   // uniform width — every bar the same size
  const gap  = 5;
  const viewW = 100;
  const viewH = bars.length * barH + (bars.length - 1) * gap;

  const xFor = (align) => {
    if (align === 'left')   return 0;
    if (align === 'right')  return viewW - barW;
    /* center */            return (viewW - barW) / 2;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewW} ${viewH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Lorica logo"
    >
      {bars.map(([idx, align], i) => (
        <rect
          key={i}
          x={xFor(align)}
          y={i * (barH + gap)}
          width={barW}
          height={barH}
          rx={barH / 2}
          fill={`var(--color-logo-${idx}, var(--color-accent))`}
        />
      ))}
    </svg>
  );
}
