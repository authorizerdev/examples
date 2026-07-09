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
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Getting started

- Clone this repo & cd into `with-vanilla-js-custom-ui`
- Install dependencies: `npm install` or `yarn`
- Start server locally: `npm run dev` or `yarn run dev`
