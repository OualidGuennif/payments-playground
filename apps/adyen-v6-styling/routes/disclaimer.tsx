import { DisclaimerPage, ThemeToggle } from "@suite/ui/components.tsx";
import { define } from "../utils.ts";

const REPOSITORY = "https://github.com/OualidGuennif/payments-playground";

export default define.page(function Disclaimer() {
  return (
    <main class="styling-main" id="main-content">
      {
        /* This app has no shared shell, so the page carries its own toolbar,
          otherwise there is no way back to the playground. */
      }
      <div class="legal-toolbar">
        <a class="shell-glass styling-back" href="/">← Back to the playground</a>
        <div class="shell-glass">
          <ThemeToggle />
        </div>
      </div>
      <div class="legal-shell">
        <DisclaimerPage appName="Drop-in Styling" repositoryUrl={REPOSITORY} />
      </div>
    </main>
  );
});
