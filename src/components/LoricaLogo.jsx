import React from 'react';

/**
 * Lorica logo — 5 stacked rounded bars fading from purple to cyan,
 * matching the desktop application icon.
 */
export default function LoricaLogo({ size = 32, className = '' }) {
  // Each bar: [width%, color]
  const bars = [
    [100, '#9333ea'],
    [82,  '#7d51d5'],
    [63,  '#6770bf'],
    [45,  '#518fa9'],
    [28,  '#3bae94'],
  ];

  const barH   = 14;
  const gap    = 5;
  const totalH = bars.length * barH + (bars.length - 1) * gap; // 70 + 20 = 90 (but offset from 0)
  const lastY  = (bars.length - 1) * (barH + gap);             // 4 * 19 = 76
  const viewH  = lastY + barH;                                  // 76 + 14 = 90

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
      {bars.map(([w, color], i) => (
        <rect
          key={i}
          x={0}
          y={i * (barH + gap)}
          width={w}
          height={barH}
          rx={barH / 2}
          fill={color}
        />
      ))}
    </svg>
  );
}
