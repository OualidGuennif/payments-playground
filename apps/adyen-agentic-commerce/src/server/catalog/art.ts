// Spec: knowledge/components/adyen-agentic-commerce.md
// Original flat product drawings, so the demo ships no photographs or third-party images.
import type { SeasonId } from "../../lib/seasons";
import type { Colour, Shape } from "./catalog";

const SHAPES: Record<Shape, (fill: string, line: string) => string> = {
  coat: (f, l) =>
    `<path d="M88 40 L120 56 L152 40 L186 62 L198 150 L176 156 L172 104 L170 206 L70 206 L68 104 L64 156 L42 150 L54 62 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M120 56 L104 206 M120 56 L136 206" stroke="${l}" stroke-width="2.5"/>
     <path d="M74 132 H166" stroke="${l}" stroke-width="5" stroke-linecap="round"/>
     <circle cx="110" cy="100" r="3" fill="${l}"/><circle cx="130" cy="100" r="3" fill="${l}"/>`,
  sweater: (f, l) =>
    `<path d="M92 48 Q120 64 148 48 L190 70 L204 158 L180 162 L172 108 L172 196 L68 196 L68 108 L60 162 L36 158 L50 70 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M92 48 Q120 74 148 48" fill="none" stroke="${l}" stroke-width="3"/>
     <path d="M68 186 H172 M38 150 H60 M180 150 H202" stroke="${l}" stroke-width="2" stroke-dasharray="3 3"/>`,
  shirt: (f, l) =>
    `<path d="M94 44 L120 54 L146 44 L188 66 L200 150 L178 154 L170 104 L170 202 L70 202 L70 104 L62 154 L40 150 L52 66 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M94 44 L112 76 L120 54 L128 76 L146 44" fill="none" stroke="${l}" stroke-width="2.5"/>
     <path d="M120 70 V202" stroke="${l}" stroke-width="2"/>
     <rect x="136" y="96" width="20" height="20" rx="2" fill="none" stroke="${l}" stroke-width="2"/>`,
  trousers: (f, l) =>
    `<path d="M70 36 H170 L184 208 H132 L120 98 L108 208 H56 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M70 52 H170 M96 52 L100 120 M144 52 L140 120" stroke="${l}" stroke-width="2"/>`,
  socks: (f, l) =>
    `<path d="M80 36 H124 V150 Q124 176 100 186 L70 198 Q50 204 46 186 Q44 172 60 164 L80 154 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M126 46 H170 V160 Q170 186 146 196 L116 208 Q96 214 92 196" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M84 48 V70 M94 48 V70 M104 48 V70 M114 48 V70 M136 58 V80 M146 58 V80 M156 58 V80" stroke="${l}" stroke-width="2"/>`,
  tote: (f, l) =>
    `<path d="M88 96 Q88 40 120 40 Q152 40 152 96" fill="none" stroke="${l}" stroke-width="6"/>
     <path d="M52 96 H188 L178 206 H62 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <rect x="96" y="128" width="48" height="34" rx="4" fill="none" stroke="${l}" stroke-width="2"/>`,
  crossbody: (f, l) =>
    `<path d="M60 128 L120 34 L180 128" fill="none" stroke="${l}" stroke-width="5"/>
     <rect x="58" y="112" width="124" height="90" rx="18" fill="${f}" stroke="${l}" stroke-width="3"/>
     <path d="M58 140 Q120 176 182 140" fill="none" stroke="${l}" stroke-width="3"/>
     <circle cx="120" cy="160" r="6" fill="${l}"/>`,
  weekender: (f, l) =>
    `<path d="M84 104 Q84 60 120 60 Q156 60 156 104" fill="none" stroke="${l}" stroke-width="7"/>
     <rect x="30" y="98" width="180" height="96" rx="34" fill="${f}" stroke="${l}" stroke-width="3"/>
     <path d="M44 116 H196" stroke="${l}" stroke-width="2.5"/>
     <rect x="104" y="108" width="32" height="14" rx="3" fill="${l}"/>`,
  scarf: (f, l) =>
    `<path d="M46 46 H194 V194 H46 Z" fill="${f}" stroke="${l}" stroke-width="3" transform="rotate(8 120 120)"/>
     <path d="M70 70 H170 V170 H70 Z" fill="none" stroke="${l}" stroke-width="2" stroke-dasharray="6 5" transform="rotate(8 120 120)"/>
     <circle cx="120" cy="120" r="26" fill="none" stroke="${l}" stroke-width="3"/>`,
  beanie: (f, l) =>
    `<path d="M56 160 Q56 60 120 60 Q184 60 184 160 Z" fill="${f}" stroke="${l}" stroke-width="3"/>
     <rect x="48" y="150" width="144" height="40" rx="10" fill="${f}" stroke="${l}" stroke-width="3"/>
     <path d="M70 156 V184 M90 156 V184 M110 156 V184 M130 156 V184 M150 156 V184 M170 156 V184" stroke="${l}" stroke-width="2"/>
     <circle cx="120" cy="54" r="14" fill="${f}" stroke="${l}" stroke-width="3"/>`,
  belt: (f, l) =>
    `<path d="M30 132 Q120 92 210 132 L210 156 Q120 116 30 156 Z" fill="${f}" stroke="${l}" stroke-width="3"/>
     <rect x="96" y="96" width="44" height="52" rx="6" fill="none" stroke="#b8933f" stroke-width="6"/>
     <path d="M118 104 V140" stroke="#b8933f" stroke-width="4"/>`,
  cardholder: (f, l) =>
    `<rect x="52" y="64" width="136" height="112" rx="12" fill="${f}" stroke="${l}" stroke-width="3"/>
     <path d="M52 96 H188 M52 124 H188" stroke="${l}" stroke-width="2.5"/>
     <rect x="60" y="72" width="120" height="96" rx="8" fill="none" stroke="${l}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
  sunglasses: (f, l) =>
    `<circle cx="80" cy="128" r="38" fill="${f}" stroke="${l}" stroke-width="5"/>
     <circle cx="160" cy="128" r="38" fill="${f}" stroke="${l}" stroke-width="5"/>
     <path d="M116 120 Q120 110 124 120" fill="none" stroke="${l}" stroke-width="5"/>
     <path d="M42 120 L24 104 M198 120 L216 104" stroke="${l}" stroke-width="5" stroke-linecap="round"/>
     <path d="M62 112 Q72 102 84 104" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="4"/>`,
  blazer: (f, l) =>
    `<path d="M90 40 L120 52 L150 40 L188 62 L200 152 L178 156 L172 106 L172 206 L68 206 L68 106 L62 156 L40 152 L52 62 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M90 40 L104 96 L120 150 L136 96 L150 40" fill="none" stroke="${l}" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="M104 96 L94 84 M136 96 L146 84" stroke="${l}" stroke-width="2.5"/>
     <path d="M80 168 H104 M136 168 H160" stroke="${l}" stroke-width="2.5"/>
     <circle cx="120" cy="164" r="3.5" fill="${l}"/>`,
  dress: (f, l) =>
    `<path d="M96 36 Q120 50 144 36 L150 96 Q152 104 146 110 L196 208 H44 L94 110 Q88 104 90 96 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M90 108 Q120 120 150 108" fill="none" stroke="${l}" stroke-width="2.5"/>
     <path d="M104 116 L84 206 M120 118 V208 M136 116 L156 206 M112 117 L100 207 M128 117 L140 207" stroke="${l}" stroke-width="1.5" stroke-opacity=".7"/>`,
  parka: (f, l) =>
    `<path d="M96 30 Q120 18 144 30 L152 54 L190 70 L202 160 L180 164 L174 112 L172 210 L68 210 L66 112 L60 164 L38 160 L50 70 L88 54 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M96 30 Q120 46 144 30 M88 54 Q120 76 152 54" fill="none" stroke="${l}" stroke-width="2.5"/>
     <path d="M120 66 V210" stroke="${l}" stroke-width="2.5"/>
     <rect x="80" y="138" width="28" height="22" rx="3" fill="none" stroke="${l}" stroke-width="2"/>
     <rect x="132" y="138" width="28" height="22" rx="3" fill="none" stroke="${l}" stroke-width="2"/>`,
  sneaker: (f, l) =>
    `<path d="M34 150 Q36 112 70 104 L112 92 Q126 88 134 100 L150 122 Q190 128 206 146 Q212 160 200 166 H40 Q32 162 34 150 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M36 158 H204" stroke="${l}" stroke-width="2.5"/>
     <rect x="34" y="160" width="172" height="14" rx="6" fill="#f4f1ec" stroke="${l}" stroke-width="3"/>
     <path d="M104 100 L116 124 M116 96 L128 118 M92 106 L104 128" stroke="${l}" stroke-width="2"/>`,
  boot: (f, l) =>
    `<path d="M84 44 H140 V138 Q178 142 196 156 Q204 166 196 174 H70 Q62 172 64 160 L74 140 Q80 120 82 96 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M100 60 Q112 92 100 124 M124 60 Q112 92 124 124" fill="none" stroke="${l}" stroke-width="2" stroke-dasharray="4 4"/>
     <rect x="62" y="172" width="138" height="14" rx="4" fill="${l}"/>
     <path d="M84 44 L80 30 H92 L96 44" fill="none" stroke="${l}" stroke-width="2.5"/>`,
  loafer: (f, l) =>
    `<path d="M36 146 Q38 120 72 114 L126 106 Q150 104 170 118 Q204 132 206 154 Q206 168 190 170 H48 Q34 166 36 146 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M110 112 Q150 108 176 128" fill="none" stroke="${l}" stroke-width="2.5"/>
     <rect x="124" y="118" width="34" height="10" rx="3" fill="none" stroke="${l}" stroke-width="2.5" transform="rotate(10 141 123)"/>
     <rect x="38" y="168" width="168" height="10" rx="4" fill="${l}"/>`,
  backpack: (f, l) =>
    `<path d="M92 56 Q92 32 120 32 Q148 32 148 56" fill="none" stroke="${l}" stroke-width="6"/>
     <rect x="62" y="52" width="116" height="156" rx="26" fill="${f}" stroke="${l}" stroke-width="3"/>
     <path d="M62 92 Q120 114 178 92" fill="none" stroke="${l}" stroke-width="2.5"/>
     <rect x="84" y="138" width="72" height="46" rx="10" fill="none" stroke="${l}" stroke-width="2.5"/>
     <path d="M92 150 H148" stroke="${l}" stroke-width="2"/>`,
  bucket: (f, l) =>
    `<path d="M70 100 L120 36 L170 100" fill="none" stroke="${l}" stroke-width="4"/>
     <path d="M66 96 H174 L166 196 Q120 208 74 196 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M66 110 Q120 124 174 110" fill="none" stroke="${l}" stroke-width="2.5" stroke-dasharray="5 4"/>
     <path d="M120 112 L110 140 M120 112 L130 140" stroke="${l}" stroke-width="2.5"/>
     <circle cx="110" cy="144" r="4" fill="${l}"/><circle cx="130" cy="144" r="4" fill="${l}"/>`,
  sling: (f, l) =>
    `<path d="M40 70 Q120 40 200 130" fill="none" stroke="${l}" stroke-width="6"/>
     <path d="M58 112 Q120 84 182 112 Q196 150 176 178 Q120 196 64 178 Q44 150 58 112 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M66 128 Q120 108 174 128" fill="none" stroke="${l}" stroke-width="2.5"/>
     <path d="M84 156 Q120 166 156 156" fill="none" stroke="${l}" stroke-width="2"/>`,
  tee: (f, l) =>
    `<path d="M96 44 Q120 58 144 44 L190 66 L178 100 L162 94 L162 204 L78 204 L78 94 L62 100 L50 66 Z" fill="${f}" stroke="${l}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M96 44 Q120 66 144 44" fill="none" stroke="${l}" stroke-width="3"/>
     <path d="M78 194 H162" stroke="${l}" stroke-width="2" stroke-dasharray="3 3"/>`,
  kit: (f, l) =>
    `<rect x="40" y="112" width="160" height="88" rx="14" fill="${f}" stroke="${l}" stroke-width="3"/>
     <rect x="62" y="56" width="44" height="72" rx="10" fill="#9a6b42" stroke="${l}" stroke-width="3"/>
     <path d="M66 128 V146 M74 128 V146 M82 128 V146 M90 128 V146 M98 128 V146" stroke="${l}" stroke-width="2"/>
     <rect x="128" y="74" width="22" height="54" rx="3" fill="#b5653f" stroke="${l}" stroke-width="2.5"/>
     <rect x="156" y="82" width="22" height="46" rx="3" fill="#b5653f" stroke="${l}" stroke-width="2.5"/>
     <path d="M40 150 H200" stroke="${l}" stroke-width="2" stroke-dasharray="5 4"/>`,
};

export function productSvg(shape: Shape, colour: Colour): string {
  const line = "#1d1d1f";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="480" height="480" role="img" aria-label="${colour.label}">
  <rect width="240" height="240" fill="#f4f1ec"/>
  <ellipse cx="120" cy="214" rx="80" ry="8" fill="#000" fill-opacity=".06"/>
  ${SHAPES[shape](colour.hex, line)}
</svg>`;
}

// The first-order gift (ADR-020): one canvas tote per season with its own stitched emblem. Only
// the four season ids reach this function, so nothing a caller sends is written into the SVG.
const TOTES: Record<SeasonId, { canvas: string; stitch: string; word: string; emblem: string }> = {
  winter: {
    canvas: "#34474f",
    stitch: "#f1ece2",
    word: "WINTER",
    emblem: `<g stroke="#f1ece2" stroke-width="2.5" stroke-linecap="round">
       <path d="M120 122 V170 M99 134 L141 158 M99 158 L141 134"/>
       <path d="M114 126 L120 132 L126 126 M114 166 L120 160 L126 166"/>
     </g>`,
  },
  spring: {
    canvas: "#ccd2b8",
    stitch: "#5f6e4c",
    word: "SPRING",
    emblem: `<path d="M120 172 Q118 146 128 122" fill="none" stroke="#5f6e4c" stroke-width="2.5"/>
     <ellipse cx="111" cy="148" rx="9" ry="4.5" fill="#5f6e4c" transform="rotate(-30 111 148)"/>
     <ellipse cx="132" cy="140" rx="9" ry="4.5" fill="#5f6e4c" transform="rotate(25 132 140)"/>
     <circle cx="129" cy="121" r="5" fill="#d9a5a0"/>`,
  },
  summer: {
    canvas: "#eadcc0",
    stitch: "#a8822f",
    word: "SUMMER",
    emblem: `<circle cx="120" cy="140" r="13" fill="none" stroke="#c9a24a" stroke-width="3"/>
     <path d="M70 164 H170 M76 172 H164" stroke="#c9a24a" stroke-width="3" stroke-linecap="round"/>`,
  },
  autumn: {
    canvas: "#b5673f",
    stitch: "#f3dcb0",
    word: "AUTUMN",
    emblem: `<path d="M120 122 Q142 132 136 156 Q126 170 120 172 Q114 170 104 156 Q98 132 120 122 Z" fill="#e2b05a"/>
     <path d="M120 128 V176" stroke="#7a3f22" stroke-width="2"/>`,
  },
};

export function welcomeToteSvg(season: SeasonId): string {
  const t = TOTES[season];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="480" height="480" role="img" aria-label="${t.word.toLowerCase()} tote bag edition">
  <rect width="240" height="240" fill="#f4f1ec"/>
  <ellipse cx="120" cy="214" rx="80" ry="8" fill="#000" fill-opacity=".06"/>
  <path d="M88 96 Q88 40 120 40 Q152 40 152 96" fill="none" stroke="#1d1d1f" stroke-width="6"/>
  <path d="M52 96 H188 L178 206 H62 Z" fill="${t.canvas}" stroke="#1d1d1f" stroke-width="3" stroke-linejoin="round"/>
  <path d="M58 106 H182 L173 198 H67 Z" fill="none" stroke="${t.stitch}" stroke-width="1.5" stroke-dasharray="4 4"/>
  ${t.emblem}
  <text x="120" y="192" text-anchor="middle" font-family="Georgia, serif" font-size="10" letter-spacing="4" fill="${t.stitch}">${t.word}</text>
</svg>`;
}
