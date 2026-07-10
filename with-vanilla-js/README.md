# Authorizer Example with Vanilla JS

Uses [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) v3 via the UMD CDN build.

## Configuration

Update the constructor in `index.html` with your instance details:

```js
const authorizerRef = new authorizerdev.Authorizer({
  authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
  redirectURL: window.location.href, // URL to redirect to after login
  clientID: 'YOUR_CLIENT_ID', // Client ID from the Authorizer dashboard
});
```

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Local Setup

- Clone the repo `git clone https://github.com/authorizerdev/examples.git`
- Change directory to vanilla JS `cd with-vanilla-js`
- Install dependencies `npm install`
- Start project `npm start` (Vite dev server) or build with `npm run build`
