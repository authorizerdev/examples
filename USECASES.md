# Authorizer Use-Case Examples

Beyond the framework quickstarts (`with-react`, `with-nextjs`, `with-vue`, `with-go`, `with-python`, …), these examples each demonstrate one authentication / authorization capability end to end. Most machine-identity examples require an Authorizer server built from `main` (`make dev` in the server repo) — each README states its prerequisites.

## Machine & agent identity

| Example | What it shows |
| --- | --- |
| [`with-m2m-client-credentials`](./with-m2m-client-credentials) | A background worker authenticating as itself: register a service account (`_create_client`), then the OAuth2 `client_credentials` grant with scope ceilings |
| [`with-token-exchange-delegation`](./with-token-exchange-delegation) | RFC 8693 token exchange: an agent acts on behalf of a user with a short-lived, down-scoped, resource-bound token carrying the `act` claim |
| [`with-agent-delegation`](./with-agent-delegation) | Multi-hop AI-agent delegation chains built on token exchange |
| [`with-agent-permissions`](./with-agent-permissions) | Per-agent permissions: an agent's authority is `perms(agent) ∩ perms(user)` — the Confused Deputy fix |
| [`with-mcp`](./with-mcp) | MCP server protected by Authorizer as an OAuth 2.1 AS: RFC 9728 protected-resource metadata, RFC 8707 resource-bound tokens |
| [`with-a2a-agent-card`](./with-a2a-agent-card) | An A2A v1.0 Agent Card whose `securitySchemes.oauth2` points at Authorizer, authenticated as an ordinary OAuth2 resource server |
| [`with-claude-agents`](./with-claude-agents) | Two independent Claude Agent SDK agents delegating over real HTTP, gated by a fail-closed OpenFGA `can_deploy` check keyed to the user, not the agent |
| [`with-k8s-tokenreview`](./with-k8s-tokenreview) | Kubernetes workloads authenticating with service-account tokens (RFC 7523 `client_assertion`, TokenReview) |
| [`with-spiffe`](./with-spiffe) | SPIFFE/SPIRE workload identity as the client credential |

## Fine-grained authorization (FGA)

| Example | What it shows |
| --- | --- |
| [`with-fga-permissions`](./with-fga-permissions) | ReBAC basics: author a model and tuples via the admin `_fga_*` API, then `check_permissions` / `list_permissions` as a user |
| [`with-fga-advanced`](./with-fga-advanced) | Advanced modeling patterns: groups, hierarchies, conditions |

## Protocols & architecture

| Example | What it shows |
| --- | --- |
| [`with-openid-connect`](./with-openid-connect) | Standard OIDC authorization-code flow against Authorizer as the IdP |
| [`with-microservices`](./with-microservices) | Token validation across multiple services |

## Enterprise / organizations

| Example | What it shows |
| --- | --- |
| [`with-org-sso-oidc`](./with-org-sso-oidc) | Per-organization SSO via an upstream OIDC provider |
| [`with-org-saml`](./with-org-saml) | Per-organization SSO via SAML |
| [`with-scim`](./with-scim) | SCIM user provisioning / deprovisioning |
