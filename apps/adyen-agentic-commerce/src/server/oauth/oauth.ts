// Spec: knowledge/components/adyen-agentic-commerce.md
// The authorization server: PAP 1.0 clients (client metadata documents + private_key_jwt) and
// generic MCP clients (RFC 7591 public clients); authorization code + PKCE S256, or the device
// authorization grant (RFC 8628) for clients that declare it.
// One file per responsibility; this file only names what the rest of the app may use.
export {
  ADVERTISED_SCOPES,
  agentScopeDescription,
  allows,
  isScope,
  type Scope,
  SCOPES,
} from "./scopes";
export {
  type Auth,
  type Client,
  DEVICE_GRANT,
  DEVICE_REQUESTS_MAX,
  type Grant,
  issuer,
  limitOf,
  OAuthError,
  SPEND_LIMIT_MAX,
  type Token,
} from "./shared";
export { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
export {
  assertionAudienceUsed,
  CLIENT_ASSERTION_ALGS,
  forgetClientKeys,
  metadataUrlAllowed,
  registerClient,
  resolveClient,
  verifyWithClientKeys,
} from "./clients";
export { type AuthorizeOutcome, decide, pendingRequest, startAuthorization } from "./authorize";
export {
  forgetCodeMisses,
  formatUserCode,
  startDeviceAuthorization,
  trackedMissAddresses,
  verifyUserCode,
} from "./device";
export {
  authenticate,
  chargeGrant,
  type ResourcePath,
  grants,
  issueAccessTokenForGrant,
  jwkThumbprint,
  liveAuth,
  peekAuth,
  revokeEndpoint,
  tokenEndpoint,
  updateGrant,
} from "./tokens";
