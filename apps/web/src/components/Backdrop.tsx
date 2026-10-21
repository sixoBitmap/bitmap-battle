// A Roman amphitheatre at sunset behind the parchment panels: sky, three tiers of arches with the crowd between
// them, banners on the podium wall and the sand. Pure SVG patterns, so it costs almost nothing to draw.

// The top edge of the podium wall, the curve M-60 600 Q800 510 1660 600, at a given x.
const podium = (x: number) => {
  const t = (x + 60) / 1720;
  return 600 - 180 * t * (1 - t);
};

export function Backdrop() {
  return (
    <svg className="backdrop" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="bb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b0f08" />
          <stop offset="0.35" stopColor="#9a3412" />
          <stop offset="0.55" stopColor="#dd6b20" />
          <stop offset="0.7" stopColor="#f6a54b" />
        </linearGradient>
        <radialGradient id="bb-sun" cx="0.5" cy="0.32" r="0.45">
          <stop offset="0" stopColor="#ffd28a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffd28a" stopOpacity="0" />
        </radialGradient>
        <pattern id="bb-arch-far" width="34" height="46" patternUnits="userSpaceOnUse">
          <rect width="34" height="46" fill="#a87443" />
          <path d="M6 46V20a11 11 0 0 1 22 0v26z" fill="#4a2414" />
          <rect width="34" height="4" fill="#cf9c62" />
          <rect width="3" height="46" fill="#875a31" />
        </pattern>
        <pattern id="bb-arch-mid" width="52" height="68" patternUnits="userSpaceOnUse">
          <rect width="52" height="68" fill="#b5804b" />
          <path d="M8 68V30a18 18 0 0 1 36 0v38z" fill="#43200f" />
          <rect width="52" height="6" fill="#dcab6f" />
          <rect width="4" height="68" fill="#8d5f34" />
          <rect x="46" width="6" height="68" fill="#c99560" />
        </pattern>
        <pattern id="bb-crowd" width="14" height="12" patternUnits="userSpaceOnUse">
          <rect width="14" height="12" fill="#3a1d0e" />
          <circle cx="3.5" cy="4" r="2.6" fill="#d9a066" />
          <rect x="1" y="6.5" width="5" height="5.5" rx="1.5" fill="#7c2d1d" />
          <circle cx="10.5" cy="5" r="2.6" fill="#c58a54" />
          <rect x="8" y="7.5" width="5" height="4.5" rx="1.5" fill="#e8d7b0" />
        </pattern>
        <pattern id="bb-crowd-far" width="9" height="8" patternUnits="userSpaceOnUse">
          <rect width="9" height="8" fill="#43220f" />
          <circle cx="2.5" cy="3" r="1.7" fill="#c68f59" />
          <circle cx="6.8" cy="4" r="1.7" fill="#e3cfa3" />
          <rect x="0.8" y="4.6" width="3.4" height="3.4" fill="#8a3322" />
        </pattern>
        <linearGradient id="bb-sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9a35f" />
          <stop offset="1" stopColor="#8a5a2b" />
        </linearGradient>
        <radialGradient id="bb-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.72" />
        </radialGradient>
      </defs>

      <rect width="1600" height="900" fill="url(#bb-sky)" />
      <rect width="1600" height="900" fill="url(#bb-sun)" />

      <path d="M-50 70 L380 150 L420 40 Z M1650 70 L1220 150 L1180 40 Z" fill="#e7c48d" opacity="0.35" />
      <path d="M380 150 L800 120 L1220 150 L1180 40 L800 20 L420 40 Z" fill="#f1d7a6" opacity="0.18" />

      <path d="M-60 300 Q800 210 1660 300 L1660 352 Q800 262 -60 352 Z" fill="url(#bb-arch-far)" />
      <path d="M-60 352 Q800 262 1660 352 L1660 420 Q800 330 -60 420 Z" fill="url(#bb-crowd-far)" />
      <path d="M-60 420 Q800 330 1660 420 L1660 498 Q800 408 -60 498 Z" fill="url(#bb-arch-mid)" />
      <path d="M-60 498 Q800 408 1660 498 L1660 600 Q800 510 -60 600 Z" fill="url(#bb-crowd)" />

      <path d="M-60 600 Q800 510 1660 600 L1660 676 Q800 586 -60 676 Z" fill="#5a3218" />
      <path d="M-60 600 Q800 510 1660 600 L1660 612 Q800 522 -60 612 Z" fill="#c9965c" />
      {[110, 330, 560, 1000, 1230, 1460].map((x, i) => (
        <g key={x} transform={`translate(${x} ${podium(x + 23) + 4})`}>
          <path d="M0 6h46v58l-23 14-23-14z" fill={i % 2 ? '#7f1d1d' : '#1e3a8a'} />
          <path d="M0 6h46v6H0z" fill="#e2b04a" />
          <circle cx="23" cy="36" r="9" fill="none" stroke="#e2b04a" strokeWidth="3" />
        </g>
      ))}

      <path d="M-60 676 Q800 586 1660 676 L1660 900 L-60 900 Z" fill="url(#bb-sand)" />
      <ellipse cx="800" cy="860" rx="700" ry="90" fill="#e9b978" opacity="0.35" />
      <rect width="1600" height="900" fill="url(#bb-vignette)" />
    </svg>
  );
}
