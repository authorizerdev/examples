# Authorizer Example with Python

Signup, login and profile with the [Python SDK](https://github.com/authorizerdev/authorizer-python) (`authorizer-py` 0.2.0) sync client, plus the admin client listing users.

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
- Admin operations authenticate with the `x-authorizer-admin-secret` header, handled by `AuthorizerAdminClient`.
