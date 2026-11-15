// Spec: knowledge/components/adyen-v6-styling.md
import { TestPill } from "@suite/ui/components.tsx";
import { ADYEN_WEB_VERSION } from "@/components/adyenOptions.ts";
import { ClientPlayground } from "@/components/ClientPlayground.tsx";

export default function Home() {
  return (
    <main className="styling-main" id="main-content">
      <ClientPlayground />
      {
        /* The only place on the deployed site that says what this is and who
          carries the obligations if someone copies it. It also carries the
          TEST pill and the SDK version, which the toolbar no longer shows. */
      }
      <footer className="styling-footer">
        <span className="styling-footer__meta">
          <TestPill />
          © 2026 Payments Playground · Adyen Web {ADYEN_WEB_VERSION}
        </span>
        <a href="/disclaimer">Disclaimer</a>
      </footer>
    </main>
  );
}
