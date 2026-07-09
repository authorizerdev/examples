# Authorizer Example with Express.js

Express middleware that validates Authorizer JWTs using [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) (v3).

## Configuration

Update the constructor in `auth_middleware.js` with your instance details:

```js
const authRef = new Authorizer({
  authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
  redirectURL: 'https://your-app.example.com', // URL to redirect to after login
  clientID: 'YOUR_CLIENT_ID', // Client ID from the Authorizer dashboard
});
```

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Run

```sh
npm install
npm start
# GET http://localhost:3000/ with an `Authorization: Bearer <id_token>` header
```
