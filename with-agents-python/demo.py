"""Agent delegation with the Authorizer Python SDK (RFC 8693).

An orchestrator agent acts on behalf of a user and re-delegates to a
specialist agent. Each agent has its own service-account identity; the user
stays the subject (`sub`) the whole way down, and every hop appends to the
nested `act` (actor) claim while the scope can only narrow.

    python demo.py            # sync flow
    python demo.py --async    # same flow on the async client

Requires an Authorizer server built from main (`make dev` in the server
repo) and the Authorizer Python SDK (token exchange ships in
`authorizer-py>=0.3.0rc3`):

    pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
import time

from authorizer import (
    GRANT_TYPE_CLIENT_CREDENTIALS,
    GRANT_TYPE_TOKEN_EXCHANGE,
    TOKEN_TYPE_ACCESS_TOKEN,
    AsyncAuthorizerClient,
    AuthorizerClient,
    GetTokenRequest,
    SignUpRequest,
)
from authorizer import AuthorizerError

AUTHORIZER_URL = os.environ.get("AUTHORIZER_URL", "http://localhost:8080")
CLIENT_ID = os.environ.get("AUTHORIZER_CLIENT_ID", "")

ORCHESTRATOR_ID = os.environ.get("ORCHESTRATOR_CLIENT_ID", "")
ORCHESTRATOR_SECRET = os.environ.get("ORCHESTRATOR_CLIENT_SECRET", "")
SPECIALIST_ID = os.environ.get("SPECIALIST_CLIENT_ID", "")
SPECIALIST_SECRET = os.environ.get("SPECIALIST_CLIENT_SECRET", "")


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def claims(jwt: str) -> dict:
    payload = jwt.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def print_act_chain(token: str, label: str) -> None:
    c = claims(token)
    print(f"\n== {label} ==")
    print(f"   sub   : {c.get('sub')}  (the user — unchanged at every hop)")
    print(f"   aud   : {c.get('aud')}")
    print(f"   scope : {c.get('scope')}")
    chain, act, depth = [], c.get("act"), 0
    while isinstance(act, dict):
        chain.append(act.get("sub"))
        act, depth = act.get("act"), depth + 1
    print(f"   act   : {' -> acting-for -> '.join(chain) or '(none)'}  (depth {depth})")


def run_sync() -> None:
    if not all([CLIENT_ID, ORCHESTRATOR_ID, ORCHESTRATOR_SECRET, SPECIALIST_ID, SPECIALIST_SECRET]):
        die("run setup.py first and export the variables it prints")

    client = AuthorizerClient(client_id=CLIENT_ID, authorizer_url=AUTHORIZER_URL)

    # 1. The user signs up / logs in (fresh email keeps the demo re-runnable).
    email = f"agents-demo+{int(time.time())}@example.com"
    user = client.signup(
        SignUpRequest(
            email=email,
            password="Agents-demo-1!",
            confirm_password="Agents-demo-1!",
            scope=["openid", "email", "crm:read", "crm:write", "report:write"],
        )
    )
    print(f"1. user token minted for {email}")
    print(f"   scope: {claims(user.access_token).get('scope')}")

    # 2. The orchestrator authenticates as ITSELF (client_credentials).
    orch = _machine_token(ORCHESTRATOR_ID, ORCHESTRATOR_SECRET)
    print("\n2. orchestrator machine token obtained (client_credentials)")

    # 3. Hop 1 — orchestrator exchanges the USER's token for a delegated token.
    hop1 = _machine_client(ORCHESTRATOR_ID).get_token(
        GetTokenRequest(
            grant_type=GRANT_TYPE_TOKEN_EXCHANGE,
            client_secret=ORCHESTRATOR_SECRET,  # the agent authenticates the exchange
            subject_token=user.access_token,
            subject_token_type=TOKEN_TYPE_ACCESS_TOKEN,
            actor_token=orch.access_token,
            actor_token_type=TOKEN_TYPE_ACCESS_TOKEN,
            scope="crm:read crm:write",
            resource="https://crm.internal.example",
        )
    )
    print_act_chain(hop1.access_token, "3. hop 1: orchestrator acting for the user")

    # 4. Hop 2 — the specialist re-delegates FROM the delegated token.
    spec = _machine_token(SPECIALIST_ID, SPECIALIST_SECRET)
    hop2 = _machine_client(SPECIALIST_ID).get_token(
        GetTokenRequest(
            grant_type=GRANT_TYPE_TOKEN_EXCHANGE,
            client_secret=SPECIALIST_SECRET,
            subject_token=hop1.access_token,  # delegated tokens are re-exchangeable
            subject_token_type=TOKEN_TYPE_ACCESS_TOKEN,
            actor_token=spec.access_token,
            actor_token_type=TOKEN_TYPE_ACCESS_TOKEN,
            scope="crm:read",  # narrower again — attenuation is monotonic
            resource="https://reports.internal.example",
        )
    )
    print_act_chain(hop2.access_token, "4. hop 2: specialist acting for (orchestrator acting for user)")

    # 5. Negative case: re-widening past the narrowed token is rejected.
    print("\n5. specialist tries to re-widen to crm:write from the crm:read token…")
    try:
        _machine_client(SPECIALIST_ID).get_token(
            GetTokenRequest(
                grant_type=GRANT_TYPE_TOKEN_EXCHANGE,
                client_secret=SPECIALIST_SECRET,
                subject_token=hop2.access_token,
                subject_token_type=TOKEN_TYPE_ACCESS_TOKEN,
                actor_token=spec.access_token,
                actor_token_type=TOKEN_TYPE_ACCESS_TOKEN,
                scope="crm:write",
                resource="https://crm.internal.example",
            )
        )
        die("re-widening was NOT rejected — server misconfigured?")
    except AuthorizerError as exc:
        print(f"   rejected as expected: {exc}")

    print("\nOK: two-hop delegation with monotonic attenuation demonstrated.")


def _machine_client(client_id: str) -> AuthorizerClient:
    return AuthorizerClient(client_id=client_id, authorizer_url=AUTHORIZER_URL)


def _machine_token(client_id: str, secret: str):
    return _machine_client(client_id).get_token(
        GetTokenRequest(grant_type=GRANT_TYPE_CLIENT_CREDENTIALS, client_secret=secret)
    )


async def run_async() -> None:
    """The same first hop on the async client — the API mirrors the sync one."""
    if not all([CLIENT_ID, ORCHESTRATOR_ID, ORCHESTRATOR_SECRET]):
        die("run setup.py first and export the variables it prints")
    async with AsyncAuthorizerClient(client_id=CLIENT_ID, authorizer_url=AUTHORIZER_URL) as client:
        email = f"agents-demo-async+{int(time.time())}@example.com"
        user = await client.signup(
            SignUpRequest(
                email=email,
                password="Agents-demo-1!",
                confirm_password="Agents-demo-1!",
                scope=["openid", "crm:read"],
            )
        )
    async with AsyncAuthorizerClient(client_id=ORCHESTRATOR_ID, authorizer_url=AUTHORIZER_URL) as orch_client:
        orch = await orch_client.get_token(
            GetTokenRequest(grant_type=GRANT_TYPE_CLIENT_CREDENTIALS, client_secret=ORCHESTRATOR_SECRET)
        )
        hop1 = await orch_client.get_token(
            GetTokenRequest(
                grant_type=GRANT_TYPE_TOKEN_EXCHANGE,
                client_secret=ORCHESTRATOR_SECRET,
                subject_token=user.access_token,
                subject_token_type=TOKEN_TYPE_ACCESS_TOKEN,
                actor_token=orch.access_token,
                actor_token_type=TOKEN_TYPE_ACCESS_TOKEN,
                scope="crm:read",
                resource="https://crm.internal.example",
            )
        )
    print_act_chain(hop1.access_token, "async: orchestrator acting for the user")
    print("\nOK: async delegation hop demonstrated.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--async", dest="use_async", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_async()) if args.use_async else run_sync()
