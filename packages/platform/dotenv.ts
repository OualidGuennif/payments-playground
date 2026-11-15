// Spec: knowledge/components/platform-package.md
// The one dotenv reader of the repository, used by config.ts and the Bun launcher. It never expands
// `$name`: an Adyen TEST key may contain `$`, and an expanding loader once cut one and gave 401s.

/** Parses `KEY=value` lines; `export ` prefixes, comments and blank lines are skipped. */
export function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/^\s*export\s+/, "");
    const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    const rest = raw.trimStart();
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // A quoted value may span lines until its closing quote.
      let body = rest.slice(1);
      while (!closes(body, quote) && index + 1 < lines.length) body += `\n${lines[++index]}`;
      const end = closingIndex(body, quote);
      const value = end === -1 ? body : body.slice(0, end);
      values[key] = quote === '"' ? value.replace(/\\n/g, "\n").replace(/\\(["\\])/g, "$1") : value;
      continue;
    }
    values[key] = rest.replace(/\s+#.*$/, "").trim();
  }
  return values;
}

function closingIndex(body: string, quote: string): number {
  for (let index = 0; index < body.length; index++) {
    if (body[index] === "\\" && quote === '"') {
      index++;
      continue;
    }
    if (body[index] === quote) return index;
  }
  return -1;
}

function closes(body: string, quote: string): boolean {
  return closingIndex(body, quote) !== -1;
}
