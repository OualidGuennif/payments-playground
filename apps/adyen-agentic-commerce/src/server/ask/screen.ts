// Spec: knowledge/components/ask-agent.md
// Between the store's MCP answers and whoever reads them (spec invariant 18). A tool result is
// untrusted data (OWASP LLM01, Microsoft's isolation of untrusted content): a store field can carry
// text another agent or shopper wrote. What could steer the agent is withheld, and the buyer's
// personal data is masked, so no model reads it.
import { maskEmails } from "../../lib/mask";
import { strongSignature } from "./gate";

type Json = Record<string, unknown>;
const record = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export const WITHHELD = "The store's answer was withheld.";

const initial = (v: unknown) => (typeof v === "string" && v ? `${v[0]}•••` : v);

// The buyer's names and phone keep a first character; every email anywhere keeps its first letter
// and its domain.
function masked(value: unknown, key = ""): unknown {
  if (typeof value === "string") return maskEmails(value);
  if (Array.isArray(value)) return value.map((v) => masked(v));
  if (!record(value)) return value;
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (key === "buyer" && (k === "first_name" || k === "last_name" || k === "phone_number"))
      out[k] = initial(v);
    else out[k] = masked(v, k);
  }
  return out;
}

// A text item that holds JSON is masked as JSON, so its shape stays readable.
function maskedText(text: string): string {
  try {
    return JSON.stringify(masked(JSON.parse(text)));
  } catch {
    return maskEmails(text);
  }
}

export function maskResult(result: Json): Json {
  const content = Array.isArray(result.content)
    ? result.content.map((item) =>
        record(item) && item.type === "text" && typeof item.text === "string"
          ? { ...item, text: maskedText(item.text) }
          : item,
      )
    : result.content;
  return {
    ...result,
    ...(content !== undefined ? { content } : {}),
    ...("structuredContent" in result
      ? { structuredContent: masked(result.structuredContent) }
      : {}),
  };
}

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (record(value)) return Object.values(value).flatMap(strings);
  return [];
};

// For the agent: masked, or withheld as an error when any of its texts carries stage 1's strong
// signature.
export function screenForAgent(result: Json): { result: Json; withheld: boolean } {
  const texts = [
    ...strings(result.structuredContent),
    ...(Array.isArray(result.content)
      ? result.content.flatMap((item) => (record(item) ? strings(item.text) : []))
      : []),
  ];
  if (texts.some((text) => strongSignature(text)))
    return {
      withheld: true,
      result: { content: [{ type: "text", text: WITHHELD }], isError: true },
    };
  return { withheld: false, result: maskResult(result) };
}
