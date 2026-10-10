import { field, text } from "./read.ts";

/**
 * A recorded Checkout API call as a cURL command to replay it. The API key is
 * left to the shell's environment: it is never stored with the call, and a
 * copied command must not carry one.
 */
export function asCurl(method: string, endpoint: string, request: unknown): string {
  let url = endpoint;
  // GET /sessions/{id} takes its sessionResult as a query parameter.
  const sessionResult = text(field(request, "sessionResult"));
  if (method === "GET" && sessionResult) {
    url += `?sessionResult=${encodeURIComponent(sessionResult)}`;
  }
  const lines = [
    `curl -X ${method} '${url}'`,
    `  -H 'Content-Type: application/json'`,
    `  -H "X-API-Key: $ADYEN_API_KEY"`,
  ];
  if (method !== "GET") {
    // Inside single quotes a quote is closed, escaped and reopened.
    lines.push(`  -d '${JSON.stringify(request, null, 2).replace(/'/g, "'\\''")}'`);
  }
  return lines.join(" \\\n");
}
