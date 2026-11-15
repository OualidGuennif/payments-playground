// Spec: knowledge/components/adyen-v6-styling.md
import { DisclaimerPage, ThemeToggle } from "@suite/ui/components.tsx";

const REPOSITORY = "https://github.com/OualidGuennif/payments-playground";

export default function Disclaimer() {
  return (
    <main className="styling-main" id="main-content">
      {
        /* This app has no shared shell, so the page carries its own toolbar,
          otherwise there is no way back to the playground. */
      }
      <div className="legal-toolbar">
        <a className="shell-glass styling-back" href="/">← Back to the playground</a>
        <div className="shell-glass">
          <ThemeToggle />
        </div>
      </div>
      <div className="legal-shell">
        <DisclaimerPage appName="Drop-in Styling" repositoryUrl={REPOSITORY} />
      </div>
    </main>
  );
}
