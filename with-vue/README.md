# Authorizer Example with Vue 3

Minimal Vite + Vue 3 app using [`@authorizerdev/authorizer-vue`](https://www.npmjs.com/package/@authorizerdev/authorizer-vue) `1.0.0-beta.0`: login, signup and a profile page.

## Run an Authorizer instance

Any running Authorizer works. For a quick local one:

```bash
git clone https://github.com/authorizerdev/authorizer.git
cd authorizer
make dev
```

This serves Authorizer on `http://localhost:8080` with client ID `kbyuFDidLLm280LIwVFiazOqjO3ty8KH` (the values hard-coded in `src/App.vue` — change them to match your instance).

## Run the app

```bash
npm install
npm run dev
```

Open http://localhost:5173, sign up or log in, and you land on the profile page showing the authenticated user.

## Files

- `src/App.vue` — wraps the app in `AuthorizerProvider` (set `authorizerURL` / `clientID` here)
- `src/views/Login.vue` — `AuthorizerRoot` renders the full login/signup/magic-link/forgot-password UI
- `src/views/Profile.vue` — reads `user` from the injected `useAuthorizer` context, logout button
