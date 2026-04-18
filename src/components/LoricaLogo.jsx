import React from 'react';

/**
 * Lorica logo — 5 stacked rounded bars fading from the theme accent color,
 * automatically adapting to the active IDE theme.
 */
export default function LoricaLogo({ size = 32, className = '' }) {
  // Each bar: [width%, opacity]
  const bars = [
    [100, 1.0],
    [82,  0.78],
    [63,  0.56],
    [45,  0.38],
    [28,  0.22],
  ];

  const barH  = 14;
  const gap   = 5;
  const lastY = (bars.length - 1) * (barH + gap);
  const viewH = lastY + barH;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 100 ${viewH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Lorica logo"
    >
      {bars.map(([w, opacity], i) => (
        <rect
          key={i}
          x={0}
          y={i * (barH + gap)}
          width={w}
          height={barH}
          rx={barH / 2}
          fill="var(--color-accent)"
          fillOpacity={opacity}
        />
      ))}
    </svg>
  );
}
