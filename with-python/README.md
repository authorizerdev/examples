# Authorizer Example with Python

Signup, login and profile with the [Python SDK](https://github.com/authorizerdev/authorizer-python) (`authorizer-py` 0.2.0) sync client, plus an admin query listing users.

## Run an Authorizer instance

```bash
git clone https://github.com/authorizerdev/authorizer.git
cd authorizer
make dev   # http://localhost:8080, admin secret: admin
```

## Run the example

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Defaults match `make dev`; override with `AUTHORIZER_URL`, `CLIENT_ID`, `ADMIN_SECRET` env vars.

## Notes

- The pip package is **`authorizer-py`**; the import is `authorizer`.
- The client supports three wire protocols: `graphql` (default), `rest`, and `grpc` (`AuthorizerClient(..., protocol="grpc")`; gRPC needs `pip install 'authorizer-py[grpc]'`).
- Async variants exist for both clients: `AsyncAuthorizerClient`, `AsyncAuthorizerAdminClient`.
- Admin operations authenticate with the `x-authorizer-admin-secret` header, normally via `AuthorizerAdminClient`.

## Known gaps in `authorizer-py` 0.2.0

Two things this example works around, both fixed by an SDK release rather than by the example:

- **No `skip_mfa_setup`.** Since server 2.4.0 MFA is on by default, so signup/login withhold the access token and return `Proceed to mfa setup`; declining the offer is what releases the token. The SDK has no typed call for it, so `main.py` goes through the `graphql_query` escape hatch. The call is identified by the MFA session cookie, which the server marks `Secure` — httpx keeps it in its jar but will not replay it over plain `http`, so the example passes it by hand.
- **Paginated admin queries are rejected by a 2.4.0 server.** `AuthorizerAdminClient.users()` still sends `$data: PaginatedRequest`, a type the server renamed to `ListUsersRequest`, so it fails with `Unknown type "PaginatedRequest"`. `verification_requests()`, `webhooks()` and `email_templates()` have the same drift. `main.py` issues the `_users` query directly instead.
