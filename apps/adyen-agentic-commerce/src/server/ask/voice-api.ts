// Spec: knowledge/components/ask-agent.md
// The voice routes (spec Inputs and invariant 14): unlock with the password, start a call from the
// browser's SDP offer, hang up. Same page checks as every Ask route; no key or model leaves here.
import { Elysia } from "elysia";
import { json } from "../core/util";
import { clientIp } from "../protocol";
import { bodyOf, foreign, forbidden, here, liveSession, problem, voiceOffered } from "./api";
import { costToday } from "./context";
import { isRegular } from "./sessions";
import { endCall, hasCall, MAX_SDP_CHARS, startCall, unlockVoice } from "./voice";

const unavailable = () =>
  problem(404, "voice_unavailable", "Voice is not available in this conversation.");
const ended = (reason: unknown) =>
  problem(409, "session_ended", "This conversation has ended.", { reason });

export const voiceApi = new Elysia({ prefix: "/api/ask/voice" })
  .post("/unlock", async ({ request }) => {
    if (foreign(request)) return forbidden();
    const body = await bodyOf(request);
    if (!body) return problem(400, "invalid_request", "Send JSON with a password field.");
    const h = here(request);
    const live = liveSession(h);
    if (!live) return ended(h.ended);
    if (!voiceOffered(h, live)) return unavailable();
    const result = unlockVoice(live, body.password, clientIp(request));
    if (result.kind === "blocked")
      return problem(
        429,
        "rate_limited",
        "Too many tries. Please try again later.",
        {},
        { "retry-after": String(result.retryAfter) },
      );
    if (result.kind === "wrong") return problem(401, "invalid_password", "Wrong password.");
    return json(200, { unlocked: true });
  })
  .post("/call", async ({ request }) => {
    if (foreign(request)) return forbidden();
    const body = await bodyOf(request);
    const sdp = body?.sdp;
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > MAX_SDP_CHARS)
      return problem(400, "invalid_request", "Send JSON with an SDP offer.");
    const h = here(request);
    const live = liveSession(h);
    if (!live) return ended(h.ended);
    if (!voiceOffered(h, live)) return unavailable();
    if (!live.voice.unlocked)
      return problem(403, "voice_locked", "Unlock voice with its password first.");
    if (costToday() >= h.settings.limits.dailyBudgetUsd)
      return problem(
        503,
        "budget_exhausted",
        "The assistant has used today's budget. Please come back tomorrow.",
      );
    const started = await startCall({
      session: live,
      sdp,
      address: clientIp(request),
      regular: isRegular(h.customer),
    });
    if (started.ok) return json(200, { sdp: started.sdp, maxSeconds: started.maxSeconds });
    if (started.error === "session_busy")
      return problem(409, "session_busy", "A voice call is already running.");
    if (started.error === "voice_limit")
      return problem(429, "voice_limit", "Voice time is used up for now.");
    if (started.error === "voice_unavailable") return unavailable();
    return problem(502, "voice_failed", "Voice could not start. Please try again.");
  })
  .post("/hangup", ({ request }) => {
    if (foreign(request)) return forbidden();
    const live = liveSession(here(request));
    if (live && hasCall(live.id)) endCall(live.id, "ended_by_shopper");
    return json(200, { state: "closing" });
  });
