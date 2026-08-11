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
    AuthorizerAdminClient,
    AuthorizerClient,
    AuthToken,
    LoginRequest,
    SignUpRequest,
    SkipMfaSetupRequest,
)

AUTHORIZER_URL = os.environ.get("AUTHORIZER_URL", "http://localhost:8080")
CLIENT_ID = os.environ.get("CLIENT_ID", "kbyuFDidLLm280LIwVFiazOqjO3ty8KH")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "admin")

def skip_mfa_offer(client: AuthorizerClient, email: str) -> "AuthToken":
    """Decline an MFA setup offer and collect the access token it withheld.

    Since 2.4.0 MFA is on by default, so signup/login enrol nothing but OFFER
    an MFA setup: they return no access token and the message "Proceed to mfa
    setup" until the user either enrols a factor or explicitly declines.
    skip_mfa_setup records the refusal and releases the withheld token. It
    fails under --enforce-mfa, where declining is not permitted; a real app
    would drive the TOTP/OTP setup screen instead of calling this.

    One workaround lives here. The call is identified by the MFA session
    cookie set on the signup/login response, which the server marks Secure
    (--app-cookie-secure defaults to true) -- so httpx keeps it in its jar but
    will not replay it over plain http, and it has to be sent by hand.
    """
    session = client._http.cookies.get("mfa_session")
    return client.skip_mfa_setup(
        SkipMfaSetupRequest(email=email), {"Cookie": f"mfa_session={session}"}
    )


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
        access_token, expires_in = skipped.access_token, skipped.expires_in
        print("mfa setup declined, token issued")
    print("logged in, token expires in:", expires_in, "seconds")

    # Profile: authenticated with the user's own bearer token.
    profile = client.get_profile({"Authorization": f"Bearer {access_token}"})
    print("profile:", profile.email, "id:", profile.id)

    # ---- Admin client (authenticates with x-authorizer-admin-secret) ----
    admin = AuthorizerAdminClient(
        authorizer_url=AUTHORIZER_URL, admin_secret=ADMIN_SECRET
    )
    users = admin.users()  # no argument = default pagination
    print(f"admin: {users.pagination.total} user(s) on this instance:")
    for user in users.users:
        print("  -", user.email)
    admin.close()
    client.close()


if __name__ == "__main__":
    main()
