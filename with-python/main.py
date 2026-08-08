"""Authorizer Python SDK example: signup / login / profile with the sync
client, plus the admin client listing users.

Run against a local Authorizer (defaults match `make dev` in the server repo):

    pip install authorizer-py
    AUTHORIZER_URL=http://localhost:8080 \
    CLIENT_ID=kbyuFDidLLm280LIwVFiazOqjO3ty8KH \
    ADMIN_SECRET=admin \
    python main.py
"""

import os
import time

from authorizer import (
    AuthorizerClient,
    LoginRequest,
    SignUpRequest,
)

AUTHORIZER_URL = os.environ.get("AUTHORIZER_URL", "http://localhost:8080")
CLIENT_ID = os.environ.get("CLIENT_ID", "kbyuFDidLLm280LIwVFiazOqjO3ty8KH")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "admin")

SKIP_MFA_SETUP = """
mutation ($p: SkipMfaSetupRequest!) {
  skip_mfa_setup(params: $p) { access_token expires_in }
}
"""


def skip_mfa_offer(client: AuthorizerClient, email: str) -> dict:
    """Decline an MFA setup offer and collect the access token it withheld.

    Since 2.4.0 MFA is on by default, so signup/login enrol nothing but OFFER
    an MFA setup: they return no access token and the message "Proceed to mfa
    setup" until the user either enrols a factor or explicitly declines.
    skip_mfa_setup records the refusal and releases the withheld token. It
    fails under --enforce-mfa, where declining is not permitted; a real app
    would drive the TOTP/OTP setup screen instead of calling this.

    Two workarounds live here. authorizer-py 0.2.0 has no typed
    skip_mfa_setup, so the call goes through the graphql_query escape hatch.
    And the call is identified by the MFA session cookie set on the
    signup/login response, which the server marks Secure -- so httpx keeps it
    in its jar but will not replay it over plain http, and it has to be sent
    by hand.
    """
    session = client._http.cookies.get("mfa_session")
    data = client.graphql_query(
        SKIP_MFA_SETUP, {"p": {"email": email}}, {"Cookie": f"mfa_session={session}"}
    )
    return data["skip_mfa_setup"]


def main() -> None:
    # ---- Public client (protocol="graphql" is the default; also: rest, grpc)
    client = AuthorizerClient(client_id=CLIENT_ID, authorizer_url=AUTHORIZER_URL)

    # Signup with a fresh email so the example is re-runnable.
    email = f"python-demo-{int(time.time())}@example.com"
    password = "Python-demo-pass-1!"
    client.signup(
        SignUpRequest(email=email, password=password, confirm_password=password)
    )
    print("signed up:", email)

    # Login (redundant right after signup, shown for completeness).
    token = client.login(LoginRequest(email=email, password=password))
    access_token, expires_in = token.access_token, token.expires_in
    if access_token is None:
        # MFA setup was offered and the token withheld -- decline it.
        print("mfa setup offered:", token.message)
        skipped = skip_mfa_offer(client, email)
        access_token, expires_in = skipped["access_token"], skipped["expires_in"]
        print("mfa setup declined, token issued")
    print("logged in, token expires in:", expires_in, "seconds")

    # Profile: authenticated with the user's own bearer token.
    profile = client.get_profile({"Authorization": f"Bearer {access_token}"})
    print("profile:", profile.email, "id:", profile.id)

    # ---- Admin operations (authenticate with x-authorizer-admin-secret) ----
    # This SHOULD be AuthorizerAdminClient(...).users(), but that method is
    # broken against a 2.4.0 server: authorizer-py 0.2.0 still sends
    # `$data: PaginatedRequest`, and the server renamed that input type to
    # ListUsersRequest, so the query is rejected with `Unknown type
    # "PaginatedRequest"`. The same drift affects the SDK's verification_requests,
    # webhooks and email_templates queries. Until the SDK catches up, issue the
    # query directly -- graphql_query takes per-call headers, so the admin
    # secret goes on the request the same way the admin client would send it.
    users = client.graphql_query(
        "query { _users { pagination { total } users { email } } }",
        headers={"x-authorizer-admin-secret": ADMIN_SECRET},
    )["_users"]
    print(f"admin: {users['pagination']['total']} user(s) on this instance:")
    for user in users["users"]:
        print("  -", user["email"])
    client.close()


if __name__ == "__main__":
    main()
