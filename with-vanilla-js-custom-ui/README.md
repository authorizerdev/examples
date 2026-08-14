# with-vanilla-js-custom-ui

Example on how to use [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) (v3) with a custom login UI.

## Configuration

Update the constructor in `index.html` and `login.html` with your instance details:

```js
const authorizerRef = new authorizerdev.Authorizer({
  authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
  redirectURL: window.location.origin, // URL to redirect to after login
  clientID: 'YOUR_CLIENT_ID', // Client ID from the Authorizer dashboard
});
```

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
>
> ```bash
> ./authorizer \
>   --database-type sqlite --database-url authorizer.db \
>   --url http://localhost:8080 \
>   --jwt-type HS256 --jwt-secret <jwt-secret> \
>   --encryption-key "$(openssl rand -hex 32)" \
>   --client-id <client-id> --client-secret <client-secret> \
>   --admin-secret <admin-secret>
> ```
>
> All of the above are required as of 2.4.0 — the server exits at boot if any
> is missing. `--url` is this server's own address (not the apps allowed to
> call it, which is `--allowed-origins`).

## Getting started

- Clone this repo & cd into `with-vanilla-js-custom-ui`
- Install dependencies: `npm install` or `yarn`
- Start server locally: `npm run dev` or `yarn run dev`
