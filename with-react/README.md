# Authorizer Example with React JS

Uses [`@authorizerdev/authorizer-react`](https://www.npmjs.com/package/@authorizerdev/authorizer-react) v2.

## Configuration

Update the provider in `src/Root.js` with your instance details:

```jsx
<AuthorizerProvider
  config={{
    authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
    redirectURL: window.location.href, // URL to redirect to after login
    clientID: 'YOUR_CLIENT_ID', // Client ID from the Authorizer dashboard
  }}
>
```

Don't forget the stylesheet import (see `src/index.js`):

```js
import '@authorizerdev/authorizer-react/styles.css';
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

## Local Setup

- Clone the repo `git clone https://github.com/authorizerdev/examples.git`
- Change directory to react JS `cd with-react`
- Install dependencies `npm install`
- Start project `npm start`
