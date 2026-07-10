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
    LoginRequest,
    SignUpRequest,
)

AUTHORIZER_URL = os.environ.get("AUTHORIZER_URL", "http://localhost:8080")
CLIENT_ID = os.environ.get("CLIENT_ID", "kbyuFDidLLm280LIwVFiazOqjO3ty8KH")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "admin")


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
    print("logged in, token expires in:", token.expires_in, "seconds")

    # Profile: authenticated with the user's own bearer token.
    profile = client.get_profile({"Authorization": f"Bearer {token.access_token}"})
    print("profile:", profile.email, "id:", profile.id)
    client.close()

    # ---- Admin client (authenticates with x-authorizer-admin-secret) ----
    admin = AuthorizerAdminClient(
        authorizer_url=AUTHORIZER_URL, admin_secret=ADMIN_SECRET
    )
    users = admin.users()  # default pagination
    print(f"admin: {len(users.users)} user(s) on this instance:")
    for user in users.users:
        print("  -", user.email)
    admin.close()


if __name__ == "__main__":
    main()
