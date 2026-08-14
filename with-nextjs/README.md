# Authorizer + Next.js + Tailwind CSS Example

This example shows how to use [Authorizer](https://authorizer.dev) with Next.js (pages router). It uses [`@authorizerdev/authorizer-react`](https://www.npmjs.com/package/@authorizerdev/authorizer-react) v2 and [`@authorizerdev/authorizer-js`](https://www.npmjs.com/package/@authorizerdev/authorizer-js) v3.

## Configuration

Update `config/authorizer-config.js` with your instance details:

```js
export default {
  authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
  redirectURL: 'http://localhost:3000', // URL to redirect to after login
  clientID: 'YOUR_CLIENT_ID', // Client ID from the Authorizer dashboard
};
```

The SDK stylesheet is imported in `pages/_app.js`:

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

## Run

```sh
npm install
npm run dev   # or: npm run build && npm start
```

## Deploy your own

Deploy the example using [Vercel](https://vercel.com?utm_source=github&utm_medium=readme&utm_campaign=next-example):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https://github.com/authorizerdev/examples/tree/main/with-nextjs&project-name=authorizer-with-nextjs-example&repository-name=authorizer-with-nextjs-example)
