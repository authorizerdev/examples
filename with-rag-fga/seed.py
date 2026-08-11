"""Idempotent setup for the permission-aware RAG example.

Against a running Authorizer server this script:
  1. Creates the demo users (skipped if they already exist):
       alice@acme-demo.com — engineering team member
       bob@acme-demo.com   — finance team member
       carol@acme-demo.com — org admin (sees everything)
  2. Installs the FGA authorization model (skipped if already active).
  3. Writes the relationship tuples that grant per-document access
     (only the missing ones — safe to re-run).

Resulting access matrix over docs/:

    document                       alice  bob   carol  why
    -----------------------------  -----  ----  -----  --------------------------
    company-handbook.md            yes    yes   yes    public (user:* viewer)
    api-gateway-spec.md            yes    no    yes    team:engineering#member
    incident-runbook.md            yes    no    yes    team:engineering#member
    platform-roadmap-q3.md         yes    no    yes    team:engineering#member
    q3-financial-report.md         no     yes   yes    team:finance#member
    budget-2026.md                 no     yes   yes    team:finance#member
    compensation-bands.md          no     no    yes    team:hr#member (nobody) +
    performance-review-process.md  no     no    yes      carol via org admin

Usage:
    python seed.py
"""

from __future__ import annotations

from authorizer import (
    AuthorizerAdminClient,
    AuthorizerClient,
    FgaReadTuplesRequest,
    FgaTupleInput,
    FgaWriteModelRequest,
    FgaWriteTuplesRequest,
    ListUsersRequest,
    PaginationRequest,
    SignUpRequest,
)
from authorizer.exceptions import AuthorizerError

from common import (
    AUTHORIZER_ADMIN_SECRET,
    AUTHORIZER_CLIENT_ID,
    AUTHORIZER_URL,
    DEMO_PASSWORD,
    PERSONAS,
    login_persona,
    require,
)

MODEL_DSL = """model
  schema 1.1

type user

type org
  relations
    define admin: [user]

type team
  relations
    define member: [user]

type document
  relations
    define org: [org]
    define viewer: [user, user:*, team#member]
    define can_view: viewer or admin from org
"""

# document filename -> viewer subject ("public" = every signed-in user).
DOC_VIEWERS: dict[str, str] = {
    "company-handbook.md": "user:*",
    "api-gateway-spec.md": "team:engineering#member",
    "incident-runbook.md": "team:engineering#member",
    "platform-roadmap-q3.md": "team:engineering#member",
    "q3-financial-report.md": "team:finance#member",
    "budget-2026.md": "team:finance#member",
    "compensation-bands.md": "team:hr#member",
    "performance-review-process.md": "team:hr#member",
}

# persona name -> team membership tuple target (carol gets org admin instead).
TEAM_OF: dict[str, str] = {
    "alice": "team:engineering",
    "bob": "team:finance",
}


def ensure_user(
    admin: AuthorizerAdminClient, client: AuthorizerClient, email: str
) -> str:
    """Sign the user up (tolerating 'already exists'), return their user id."""
    created = True
    try:
        res = client.signup(
            SignUpRequest(
                email=email, password=DEMO_PASSWORD, confirm_password=DEMO_PASSWORD
            )
        )
        if res.user and res.user.id:
            print(f"  created user {email}")
            return res.user.id
        # Signup succeeded but withheld the user: since 2.4.0 an MFA setup is
        # offered first, and nothing is authenticated until it is settled. The
        # account exists; resolve its id below.
    except AuthorizerError as signup_error:
        created = False
        # Signup errors are deliberately generic. A successful login with the
        # demo password is the reliable "already seeded" signal.
        try:
            login_persona(client, email)
        except AuthorizerError:
            raise SystemExit(f"signup failed for {email}: {signup_error}") from None
    users = admin.users(ListUsersRequest(pagination=PaginationRequest(limit=100)))
    for user in users.users:
        if user.email == email:
            print(f"  {'created' if created else 'found existing'} user {email}")
            return user.id
    raise SystemExit(f"could not resolve id for existing user {email}")


def ensure_model(admin: AuthorizerAdminClient) -> None:
    """Install MODEL_DSL unless the active model already matches it."""

    def normalise(dsl: str) -> list[str]:
        # The server may alphabetise relations; compare sorted meaningful lines.
        return sorted(line.strip() for line in dsl.splitlines() if line.strip())

    try:
        current = admin.fga_get_model()
        if normalise(current.dsl) == normalise(MODEL_DSL):
            print("  authorization model already active")
            return
    except AuthorizerError:
        pass  # no model yet
    admin.fga_write_model(FgaWriteModelRequest(dsl=MODEL_DSL))
    print("  authorization model installed")


def ensure_tuples(admin: AuthorizerAdminClient, tuples: list[FgaTupleInput]) -> None:
    """Write only the tuples that don't exist yet."""
    existing: set[tuple[str, str, str]] = set()
    token: str | None = None
    while True:
        page = admin.fga_read_tuples(
            FgaReadTuplesRequest(page_size=100, continuation_token=token)
        )
        existing.update((t.user, t.relation, t.object) for t in page.tuples)
        token = page.continuation_token
        if not token:
            break
    missing = [t for t in tuples if (t.user, t.relation, t.object) not in existing]
    if not missing:
        print(f"  all {len(tuples)} tuples already present")
        return
    admin.fga_write_tuples(FgaWriteTuplesRequest(tuples=missing))
    print(f"  wrote {len(missing)} tuples ({len(tuples) - len(missing)} already present)")


def main() -> None:
    url = AUTHORIZER_URL
    client_id = require("AUTHORIZER_CLIENT_ID", AUTHORIZER_CLIENT_ID)
    admin_secret = require("AUTHORIZER_ADMIN_SECRET", AUTHORIZER_ADMIN_SECRET)

    admin = AuthorizerAdminClient(url, admin_secret)
    client = AuthorizerClient(client_id, url)
    try:
        print(f"Seeding {url} ...")

        print("Users:")
        user_ids = {
            name: ensure_user(admin, client, email)
            for name, email in PERSONAS.items()
        }

        print("Model:")
        ensure_model(admin)

        print("Tuples:")
        tuples: list[FgaTupleInput] = []
        # Org admin: carol sees every document that belongs to org:acme.
        tuples.append(
            FgaTupleInput(user=f"user:{user_ids['carol']}", relation="admin", object="org:acme")
        )
        # Team memberships.
        for name, team in TEAM_OF.items():
            tuples.append(
                FgaTupleInput(user=f"user:{user_ids[name]}", relation="member", object=team)
            )
        # Per-document grants: org linkage + viewer subject.
        for doc, viewer in DOC_VIEWERS.items():
            obj = f"document:{doc}"
            tuples.append(FgaTupleInput(user="org:acme", relation="org", object=obj))
            tuples.append(FgaTupleInput(user=viewer, relation="viewer", object=obj))
        ensure_tuples(admin, tuples)

        print("Done. Try:  python rag.py --user alice \"what is our Q3 revenue?\"")
    finally:
        admin.close()
        client.close()


if __name__ == "__main__":
    main()
