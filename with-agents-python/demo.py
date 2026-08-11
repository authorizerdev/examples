"""Agent delegation with the Authorizer Python SDK (RFC 8693).

An orchestrator agent acts on behalf of a user and re-delegates to a
specialist agent. Each agent has its own service-account identity; the user
stays the subject (`sub`) the whole way down, and every hop appends to the
nested `act` (actor) claim while the scope can only narrow.

    python demo.py            # sync flow
    python demo.py --async    # same flow on the async client

Requires an Authorizer server built from main (`make dev` in the server
repo) and the Authorizer Python SDK (token exchange ships in
`authorizer-py>=0.3.0rc4`):

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
    LoginRequest,
    SignUpRequest,
    SkipMfaSetupRequest,
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


PASSWORD = "Agents-demo-1!"

# The user's own rights. Every delegated token below is carved out of these:
# an agent can only ever narrow what the user already holds.
USER_SCOPE = ["openid", "email", "crm:read", "crm:write", "report:write"]

MFA_OFFER_NOTE = """
    Since 2.4.0 MFA is on by default, so signup enrols nothing but OFFERS an
    MFA setup: it returns no access token and the message "Proceed to mfa
    setup" until the user either enrols a factor or explicitly declines.
    This demo declines, which is what skip_mfa_setup is for.

    Declining is not quite enough here. The token skip_mfa_setup releases
    carries the DEFAULT scope, not the scope signup asked for -- the pending
    MFA session does not carry the request's scope through -- and this demo
    needs the crm/report scopes it exists to attenuate. So log in again once
    the offer is out of the way: the user has now declined, so login returns
    a token directly, with the scope we ask for.

    Under --enforce-mfa declining is not permitted and skip_mfa_setup fails;
    a real app would drive the TOTP/OTP setup screen instead.
"""


def mfa_cookie(client) -> dict[str, str]:
    """Header replaying the MFA session cookie signup set on this client.

    skip_mfa_setup is identified by that cookie plus the email. The server
    marks it Secure (--app-cookie-secure defaults to true), so httpx keeps it
    in its jar but refuses to replay it over plain http and it has to be sent
    by hand. A deployment on https needs none of this.
    """
    return {"Cookie": f"mfa_session={client._http.cookies.get('mfa_session')}"}


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
            password=PASSWORD,
            confirm_password=PASSWORD,
            scope=USER_SCOPE,
        )
    )
    if user.access_token is None:  # MFA setup offered — see MFA_OFFER_NOTE
        client.skip_mfa_setup(SkipMfaSetupRequest(email=email), mfa_cookie(client))
        user = client.login(
            LoginRequest(email=email, password=PASSWORD, scope=USER_SCOPE)
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
        scope = ["openid", "crm:read"]
        user = await client.signup(
            SignUpRequest(
                email=email,
                password=PASSWORD,
                confirm_password=PASSWORD,
                scope=scope,
            )
        )
        if user.access_token is None:  # MFA setup offered — see MFA_OFFER_NOTE
            await client.skip_mfa_setup(
                SkipMfaSetupRequest(email=email), mfa_cookie(client)
            )
            user = await client.login(
                LoginRequest(email=email, password=PASSWORD, scope=scope)
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
