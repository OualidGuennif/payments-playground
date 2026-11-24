// Spec: knowledge/components/adyen-v6-styling.md
import { useState } from "react";
import { download } from "../styling-persistence.ts";

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 21h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RawOutput(props: { content: string; filename: string; mime: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="raw-output">
      <div className="raw-output__header">
        <span>Raw output</span>
        <div className="raw-output__actions">
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              navigator.clipboard
                ?.writeText(props.content)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="button button--quiet button--small raw-output__icon-btn"
            aria-label="Download"
            title="Download"
            onClick={() => download(props.filename, props.content, props.mime)}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
      <pre className="code-block raw-output__pre">{props.content}</pre>
    </div>
  );
}
