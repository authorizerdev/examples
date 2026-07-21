# Authorizer Examples

Example applications and integrations for [Authorizer](https://authorizer.dev) — the open-source, self-hosted authentication and authorization server.

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Examples

| Example | Description |
| --- | --- |
| [with-express-js](./with-express-js) | Express.js middleware validating Authorizer JWTs with `@authorizerdev/authorizer-js` |
| [with-gatsbyjs](./with-gatsbyjs) | Gatsby site with login and private routes using `@authorizerdev/authorizer-react` |
| [with-nextjs](./with-nextjs) | Next.js (pages router) app with login, session cookie, and SSR profile page |
| [with-nextjs-13](./with-nextjs-13) | Next.js 13 (app router) app with login, session cookie, and server-component profile page |
| [with-react](./with-react) | Create React App + React Router demo using `@authorizerdev/authorizer-react` |
| [with-react-native-expo](./with-react-native-expo) | React Native (Expo) OAuth2 PKCE flow with token refresh via `@authorizerdev/authorizer-js` |
| [with-svelte-kit](./with-svelte-kit) | SvelteKit app using `@authorizerdev/authorizer-svelte` components |
| [with-svelte-routing](./with-svelte-routing) | Svelte + svelte-routing app using `@authorizerdev/authorizer-svelte` |
| [with-vanilla-js](./with-vanilla-js) | Plain HTML/JS page using the `authorizer-js` UMD CDN build |
| [with-vanilla-js-custom-ui](./with-vanilla-js-custom-ui) | Custom login UI (no components) built directly on `authorizer-js` |
| [with-vue](./with-vue) | Vue 3 app integrating Authorizer |
| [with-go](./with-go) | Go backend integration with Authorizer |
| [with-python](./with-python) | Python backend integration with Authorizer |
| [with-m2m-client-credentials](./with-m2m-client-credentials) | Machine-to-machine auth using the OAuth2 client credentials grant |
| [with-token-exchange-delegation](./with-token-exchange-delegation) | RFC 8693 token exchange and delegation (`act` claim) |
| [with-fga-permissions](./with-fga-permissions) | Fine-grained authorization (ReBAC) checks with the embedded OpenFGA engine |
| [with-fga-advanced](./with-fga-advanced) | Advanced FGA modeling: hierarchies, role grants, and exclusions |
| [with-microservices](./with-microservices) | Authorizer as the auth layer across multiple microservices |
| [with-openid-connect](./with-openid-connect) | Standard OpenID Connect integration against Authorizer's OIDC endpoints |
| [with-agent-delegation](./with-agent-delegation) | Delegating scoped access to AI agents with audited delegation chains |
| [with-claude-agents](./with-claude-agents) | Two real Claude Agent SDK agents (DevOps assistant + infra agent) delegating and authorizing over HTTP, with a fail-closed OpenFGA permission gate |
| [with-mcp](./with-mcp) | Authorizer as the OAuth 2.1 authorization server protecting an MCP server (RFC 9728 + RFC 8707) |
| [with-a2a-agent-card](./with-a2a-agent-card) | A2A (Agent2Agent) v1.0 Agent Card backed by Authorizer as the OAuth2 authorization server |
| [with-k8s-tokenreview](./with-k8s-tokenreview) | Kubernetes TokenReview-based workload authentication |
| [with-spiffe](./with-spiffe) | SPIFFE/SPIRE workload identity integration |
| [with-org-sso-oidc](./with-org-sso-oidc) | Organization SSO via an upstream OIDC identity provider |
| [with-org-saml](./with-org-saml) | Organization SSO via SAML |
| [with-scim](./with-scim) | SCIM user/group provisioning against Authorizer |

## SDK versions

- [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) 3.x
- [`@authorizerdev/authorizer-react`](https://www.npmjs.com/package/@authorizerdev/authorizer-react) 2.x
- [`@authorizerdev/authorizer-svelte`](https://www.npmjs.com/package/@authorizerdev/authorizer-svelte) 0.1.x
