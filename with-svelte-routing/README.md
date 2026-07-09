# authorizer-svelte-example

Authorizer svelte example app using [`@authorizerdev/authorizer-svelte`](https://www.npmjs.com/package/@authorizerdev/authorizer-svelte) with `svelte-routing`.

## Configuration

Update the provider in `src/App.svelte` with your instance details:

```svelte
<AuthorizerProvider
  config={{
    authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
    redirectURL: window.location.origin, // URL to redirect to after login
    clientID: 'YOUR_CLIENT_ID' // Client ID from the Authorizer dashboard
  }}
>
```

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Run

```sh
npm install
npm run dev    # rollup watch + dev server
npm run build  # production build
npm start      # serve the built app
```
