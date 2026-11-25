// Spec: knowledge/components/ask-agent.md
// The browser's half of a voice call: the microphone, a WebRTC connection whose answer comes from
// our server, and a data channel that only listens. The browser never holds a key and cannot
// steer the call: the server created it and keeps its sideband.
import { type Answer, askCall } from "./askClient";
import { type VoiceEvent, voiceEvent } from "./askLogic";

const ICE_WAIT_MS = 3_000;
const HANGUP_WAIT_MS = 3_000;

export type VoiceCall = { maxSeconds: number; end: () => void };

const gathered = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, ICE_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      resolve();
    });
  });

export async function startVoiceCall(
  onEvent: (event: VoiceEvent) => void,
): Promise<{ call?: VoiceCall; problem?: Answer<unknown> }> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return {
      problem: {
        status: 0,
        error: "microphone",
        message: "The microphone is blocked. Allow it for this site, then try again.",
      },
    };
  }
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  let over = false;
  const stop = (reason?: string, quiet = false) => {
    if (over) return;
    over = true;
    for (const track of stream.getTracks()) track.stop();
    pc.close();
    audio.srcObject = null;
    if (!quiet) onEvent({ kind: "closed", reason });
  };
  pc.addEventListener("track", (event) => {
    audio.srcObject = event.streams[0] ?? null;
  });
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") stop("connection_lost");
  });
  for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
  // The label OpenAI expects; created before the offer so the offer carries it.
  const channel = pc.createDataChannel("oai-events");
  channel.addEventListener("message", (message) => {
    const event = voiceEvent(message.data);
    if (!event) return;
    if (event.kind === "closed") stop(event.reason);
    else onEvent(event);
  });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const answer = await askCall<{ sdp: string; maxSeconds: number }>("/voice/call", {
      sdp: pc.localDescription?.sdp,
    });
    if (!answer.data) {
      stop(undefined, true);
      return { problem: answer };
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answer.data.sdp });
    return {
      call: {
        maxSeconds: answer.data.maxSeconds,
        end: () => {
          void askCall("/voice/hangup", {});
          // OpenAI's closed event ends it; without one, the browser lets go anyway.
          setTimeout(() => stop("ended_by_shopper"), HANGUP_WAIT_MS);
        },
      },
    };
  } catch {
    stop(undefined, true);
    return {
      problem: { status: 0, error: "voice_failed", message: "Voice could not start. Try again." },
    };
  }
}
