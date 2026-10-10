import { TestPill } from "@suite/ui/components.tsx";
import { ADYEN_WEB_VERSION } from "../components/adyenOptions.ts";
import StylingPlayground from "../islands/StylingPlayground.tsx";
import { define } from "../utils.ts";

export default define.page(function Home() {
  return (
    <main class="styling-main" id="main-content">
      <StylingPlayground />
      {
        /* The only place on the deployed site that says what this is and who
          carries the obligations if someone copies it. It also carries the
          TEST pill and the SDK version, which the toolbar no longer shows. */
      }
      <footer class="styling-footer">
        <span class="styling-footer__meta">
          <TestPill />
          © 2026 Payments Playground · Adyen Web {ADYEN_WEB_VERSION}
        </span>
        <a href="/disclaimer">Disclaimer</a>
      </footer>
    </main>
  );
});
