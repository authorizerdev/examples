# Webhooks

Register a webhook for the `user.signup` event, trigger it with a real
signup, and verify the delivery signature.

**Ops used**: `_add_webhook`, `_webhooks`, `_delete_webhook` (admin) +
`signup` / `verify_email` to trigger the event.

## What the server sends

`POST <endpoint>` with JSON body:

```json
{
  "webhook_id": "...",
  "event_name": "user.signup",
  "event_description": "user signup",
  "auth_recipe": "basic_auth",
  "user": { "id": "...", "email": "...", "roles": ["user"], ... }
}
```

plus any custom headers you registered, and:

- **`X-Authorizer-Signature`** — hex `HMAC-SHA256(raw_body, client_secret)`.
  Verify it before trusting a delivery (see `webhook-demo.mjs`).

Available events: `user.created` (row created, pre-verification),
`user.signup` (fires at `verify_email` when email verification is on, at
signup otherwise), `user.login`, `user.deleted`, `user.deactivated`,
`user.access_revoked`, `user.access_enabled`.
Delivery attempts are recorded and queryable via `_webhook_logs`.

> **Known gap since 2.4.0.** With email verification *and* MFA both on — the
> configuration `run-server.sh` uses, and the default for MFA — `user.signup`
> never fires. `verify_email` returns from the MFA gate before reaching its
> own event registration, and `skip_mfa_setup` issues its auth response with
> `isSignUp=false`, so the path emits only `user.login`. Until the server
> carries the signup flag through the MFA session, subscribe to `user.created`
> (fires at signup, before verification) or `user.login` instead. This recipe
> still registers `user.signup` because that is the event it is about.

## SSRF protection vs. local testing

Authorizer refuses webhook endpoints on loopback/private networks (127/8,
10/8, 172.16/12, 192.168/16, link-local, CGN, ...) — both at `_add_webhook`
and again at delivery time. So `http://localhost:...` will never receive a
delivery. For a same-machine demo, alias an IP from the benchmarking range
(198.18.0.0/15 — reserved, never routed, and not on the filter's blocklist)
onto your loopback interface once:

```sh
sudo ifconfig lo0 alias 198.18.0.1 255.255.255.255   # macOS
sudo ip addr add 198.18.0.1/32 dev lo                # Linux
```

(Remove later with `sudo ifconfig lo0 -alias 198.18.0.1` /
`sudo ip addr del 198.18.0.1/32 dev lo`.)

Alternatively skip the alias and point at any public HTTPS sink:
`WEBHOOK_ENDPOINT=https://webhook.site/<your-uuid> node webhook-demo.mjs`
(the receiver wait will time out, but the payload + signature arrive at the
sink and the attempt is visible in `_webhook_logs`).

## Run

```sh
node webhook-demo.mjs
# options:
WEBHOOK_ENDPOINT=http://198.18.0.1:4567/webhook RECEIVER_PORT=4567 node webhook-demo.mjs
```

The script starts the receiver in-process, registers the webhook, signs up +
verifies a fresh user, prints the delivered payload, checks the HMAC
signature, and deletes the webhook again.
