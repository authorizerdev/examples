# Authorizer Example with React Native (Expo)

OAuth2 PKCE login flow using `expo-auth-session` plus [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) (v3) for token refresh, profile, and revocation.

## Configuration

Update the constants at the top of `App.tsx`:

```ts
const authorizerClientID = 'YOUR_CLIENT_ID'; // Client ID from the Authorizer dashboard
const authorizerURL = 'https://your-instance.example.com'; // Base URL of your Authorizer instance
```

Also add the app's redirect URI (printed on startup) to your client's authorized redirect URLs.

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

## Run

```sh
npm install
npm start        # expo start
```
