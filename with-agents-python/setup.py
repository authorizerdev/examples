"""Register the two agent service accounts for the delegation demo.

    AUTHORIZER_ADMIN_SECRET=admin python setup.py

Prints the export lines demo.py needs. Client secrets are shown ONCE.
"""

from __future__ import annotations

import os
import sys

from authorizer import AuthorizerAdminClient, CreateClientRequest

AUTHORIZER_URL = os.environ.get("AUTHORIZER_URL", "http://localhost:8080")
ADMIN_SECRET = os.environ.get("AUTHORIZER_ADMIN_SECRET", "")

AGENTS = {
    "ORCHESTRATOR": ("agents-demo-orchestrator", ["crm:read", "crm:write", "report:write"]),
    "SPECIALIST": ("agents-demo-specialist", ["crm:read", "report:write"]),
}

if not ADMIN_SECRET:
    print("error: set AUTHORIZER_ADMIN_SECRET (make dev uses 'admin')", file=sys.stderr)
    sys.exit(1)

admin = AuthorizerAdminClient(authorizer_url=AUTHORIZER_URL, admin_secret=ADMIN_SECRET)

print("# add these to your shell before running demo.py:")
for prefix, (name, scopes) in AGENTS.items():
    res = admin.create_client(
        CreateClientRequest(
            name=name,
            allowed_scopes=scopes,
            description="with-agents-python demo agent (safe to delete)",
        )
    )
    print(f"export {prefix}_CLIENT_ID={res.client.id}")
    print(f"export {prefix}_CLIENT_SECRET={res.client_secret}")
