# Authorizer Example with Express.js

Express middleware that validates Authorizer JWTs using [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) (v3).

## Configuration

Update the constructor in `auth_middleware.js` with your instance details:

```js
const authorizerURL = 'https://your-instance.example.com'; // Base URL of your Authorizer instance

const authRef = new Authorizer({
  authorizerURL,
  redirectURL: 'https://your-app.example.com', // URL to redirect to after login
  clientID: 'YOUR_CLIENT_ID', // Client ID from the Authorizer dashboard
  extraHeaders: { Origin: authorizerURL }, // required server-side, see below
});
```

`extraHeaders` is not optional here. The server's CSRF guard rejects any
state-changing request that arrives without an `Origin` (or `Referer`) header,
and `validateJWTToken` is a `POST /graphql`. Browsers set `Origin` themselves;
Node does not, so a server-side caller has to send it or every validation
fails with a `403` before the token is ever looked at.

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Run

```sh
npm install
npm start
# GET http://localhost:3000/ with an `Authorization: Bearer <id_token>` header
```
