// Spec: knowledge/components/adyen-agentic-commerce.md
// PAP 1.0 §9, task coverage: what agents cannot do at this store, with another way when there is
// one, and where an agent reports a task it could not do.
import { config } from "../core/config";
import { PapError, type PapSession, verifyPoppy } from "./pap";
import { clientIp, publicUrl, rateLimited } from "../protocol";
import { trace } from "../core/trace";
import { isRecord, json, published, readJson } from "../core/util";

const TASK_MAX = 200;
const DESCRIPTION_MAX = 2000;

// The same for every Session, so it is served without reading one and may be cached publicly.
export function tasksDocument() {
  const origin = config().publicOrigin;
  const account = { type: "web", url: `${origin}/account` };
  return {
    excluded_tasks: [
      {
        task: "Create a customer account",
        alternative: {
          instructions:
            "The User creates the account on the website; the agent then signs in to it.",
          references: [{ type: "web", url: `${origin}/sign-up` }],
        },
      },
      {
        task: "Save a card to the account",
        alternative: {
          instructions:
            "The User saves a card on their account page; an agent signed in with ucp:pay can then pay with it.",
          references: [account],
        },
      },
      {
        task: "Change an agent's spend limit",
        alternative: {
          instructions: "The User sets each agent's limit on their account page.",
          references: [account],
        },
      },
      {
        task: "Pay with a plain card number",
        alternative: {
          instructions:
            "Complete the checkout with a network token (number and expiry), with a saved card when signed in with ucp:pay, or with no instrument, then give the User continue_url to pay there.",
          references: [
            { type: "mcp", url: `${origin}/mcp`, tool: "complete_checkout" },
            {
              type: "openapi",
              url: `${origin}/ucp/v1/openapi.json`,
              operation_id: "complete_checkout",
            },
          ],
        },
      },
      { task: "Return an item or get a refund" },
    ],
    feedback: { endpoint: `${origin}/poppy/feedback` },
  };
}

// PAP 1.0 §9: Poppy-Version and the Session header are checked as at the APIs, with PAP's JSON
// errors. These endpoints describe the store, not an account: a token is never checked, but a
// Session that covers one with `ath` must cover the one sent.
async function papEdge(request: Request): Promise<{ session?: PapSession; response?: Response }> {
  const retry = rateLimited(clientIp(request));
  if (retry)
    return { response: json(429, { error: "rate_limited" }, { "retry-after": String(retry) }) };
  const accessToken = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  try {
    const session = await verifyPoppy(
      request,
      publicUrl(request),
      accessToken ? { accessToken } : undefined,
    );
    return { session };
  } catch (error) {
    if (!(error instanceof PapError)) throw error;
    return {
      response: json(error.status, { error: error.code, error_description: error.message }),
    };
  }
}

const refusedTrace = (request: Request, status: number) =>
  trace({
    channel: "pap",
    actor: "?",
    method: request.method,
    path: new URL(request.url).pathname,
    status,
    ref: null,
    detail: { refused: true },
  });

export async function handleTasks(request: Request): Promise<Response> {
  const e = await papEdge(request);
  if (e.response) {
    refusedTrace(request, e.response.status);
    return e.response;
  }
  return published(request, tasksDocument());
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max ? value : undefined;

export async function handleFeedback(request: Request): Promise<Response> {
  const e = await papEdge(request);
  if (e.response) {
    refusedTrace(request, e.response.status);
    return e.response;
  }
  const body = await readJson(request);
  const task = isRecord(body) ? text(body.task, TASK_MAX) : undefined;
  const description = isRecord(body) ? text(body.description, DESCRIPTION_MAX) : undefined;
  if (!task || !description) {
    refusedTrace(request, 400);
    return json(400, {
      error: "invalid_request",
      error_description: `task (1 to ${TASK_MAX} characters) and description (1 to ${DESCRIPTION_MAX}) are required strings`,
    });
  }
  // §9.3: a report is attributed only to a verified Session, and its text is data to read.
  trace({
    channel: "pap",
    actor: e.session?.clientName ?? "unverified agent",
    method: "POST",
    path: "/poppy/feedback",
    status: 202,
    ref: null,
    detail: { feedback: { task, description }, client: e.session?.clientId ?? null },
  });
  return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
}
