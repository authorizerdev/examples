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
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Run

```sh
npm install
npm start        # expo start
```
