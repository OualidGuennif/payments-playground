// Spec: knowledge/components/adyen-digital.md
// Adyen posts standard webhooks here; serveSecurely skips CSRF and the session outside /api/*.
import { handle } from "@/server/api";

export const POST = handle;
