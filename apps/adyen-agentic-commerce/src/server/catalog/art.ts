// Spec: knowledge/components/adyen-agentic-commerce.md
// Original flat product drawings, so the demo ships no photographs or third-party images.
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
};

export function productSvg(shape: Shape, colour: Colour): string {
  const line = "#1d1d1f";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="480" height="480" role="img" aria-label="${colour.label}">
  <rect width="240" height="240" fill="#f4f1ec"/>
  <ellipse cx="120" cy="214" rx="80" ry="8" fill="#000" fill-opacity=".06"/>
  ${SHAPES[shape](colour.hex, line)}
</svg>`;
}
