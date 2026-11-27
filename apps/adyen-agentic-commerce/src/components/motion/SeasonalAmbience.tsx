// Spec: knowledge/components/agentic-storefront.md
import type { SeasonId } from "@/lib/seasons";

// Fixed positions, sizes and timings as class names (no inline style, no random value), so the
// server's markup is the browser's and Tailwind finds every class. The last six show from 640 px.
const PARTICLES = [
  "left-[4%] size-[3px] [--o:0.16] [--dx:18px] [animation-duration:22s] [animation-delay:-3s]",
  "left-[11%] size-[4px] [--o:0.2] [--dx:-14px] [animation-duration:26s] [animation-delay:-17s]",
  "left-[19%] size-[2px] [--o:0.14] [--dx:22px] [animation-duration:18s] [animation-delay:-9s]",
  "left-[27%] size-[4px] [--o:0.22] [--dx:-20px] [animation-duration:24s] [animation-delay:-21s]",
  "left-[36%] size-[3px] [--o:0.18] [--dx:12px] [animation-duration:20s] [animation-delay:-5s]",
  "left-[45%] size-[2px] [--o:0.12] [--dx:-10px] [animation-duration:28s] [animation-delay:-13s]",
  "left-[54%] size-[4px] [--o:0.2] [--dx:16px] [animation-duration:21s] [animation-delay:-1s]",
  "left-[63%] size-[3px] [--o:0.15] [--dx:-18px] [animation-duration:25s] [animation-delay:-19s]",
  "left-[72%] size-[2px] [--o:0.24] [--dx:20px] [animation-duration:17s] [animation-delay:-7s]",
  "left-[88%] size-[4px] [--o:0.17] [--dx:-12px] [animation-duration:23s] [animation-delay:-11s]",
  "hidden sm:block left-[8%] size-[3px] [--o:0.13] [--dx:-16px] [animation-duration:27s] [animation-delay:-23s]",
  "hidden sm:block left-[31%] size-[4px] [--o:0.19] [--dx:14px] [animation-duration:19s] [animation-delay:-15s]",
  "hidden sm:block left-[49%] size-[3px] [--o:0.21] [--dx:-22px] [animation-duration:22s] [animation-delay:-25s]",
  "hidden sm:block left-[67%] size-[2px] [--o:0.14] [--dx:10px] [animation-duration:26s] [animation-delay:-2s]",
  "hidden sm:block left-[80%] size-[4px] [--o:0.23] [--dx:-8px] [animation-duration:20s] [animation-delay:-8s]",
  "hidden sm:block left-[95%] size-[3px] [--o:0.16] [--dx:18px] [animation-duration:24s] [animation-delay:-20s]",
];

export function SeasonalAmbience({ seasonId }: { seasonId: SeasonId }) {
  return (
    <div
      aria-hidden="true"
      data-season={seasonId}
      className="seasonal-ambience pointer-events-none fixed inset-0 z-10 overflow-hidden"
    >
      {PARTICLES.map((place) => (
        <span key={place} className={`ambience-particle ${place}`} />
      ))}
    </div>
  );
}
