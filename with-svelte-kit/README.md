# Authorizer Example with SvelteKit

Uses [`@authorizerdev/authorizer-svelte`](https://www.npmjs.com/package/@authorizerdev/authorizer-svelte).

## Configuration

Update the provider in `src/routes/+layout.svelte` with your instance details:

```svelte
<AuthorizerProvider
  config={{
    authorizerURL: 'https://your-instance.example.com', // Base URL of your Authorizer instance
    redirectURL: typeof window != 'undefined' ? window.location.origin : ``, // URL to redirect to after login
    clientID: 'YOUR_CLIENT_ID' // Client ID from the Authorizer dashboard
  }}
>
```

> Authorizer v2 server is configured entirely via CLI flags (no `.env` / OS env vars), e.g.
> `./authorizer --database-type sqlite --database-url authorizer.db --admin-secret <secret>`

## Developing

Once you've installed dependencies with `npm install`, start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
