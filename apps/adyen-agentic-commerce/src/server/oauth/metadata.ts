// Spec: knowledge/components/adyen-agentic-commerce.md
// The discovery documents: authorization server (RFC 8414) and protected resource (RFC 9728).
import { ADVERTISED_SCOPES } from "./scopes";
import { DEFAULT_GRANT_TYPES, DEVICE_GRANT, issuer } from "./shared";
import { CLIENT_ASSERTION_ALGS } from "./clients";

export function authorizationServerMetadata() {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    device_authorization_endpoint: `${iss}/oauth/device_authorization`,
    token_endpoint: `${iss}/oauth/token`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    registration_endpoint: `${iss}/oauth/register`,
    protected_resources: [iss, `${iss}/mcp`],
    scopes_supported: ADVERTISED_SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: [...DEFAULT_GRANT_TYPES, DEVICE_GRANT],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    token_endpoint_auth_signing_alg_values_supported: CLIENT_ASSERTION_ALGS,
    revocation_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [issuer()],
    scopes_supported: ADVERTISED_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Atelier Velune store",
  };
}
