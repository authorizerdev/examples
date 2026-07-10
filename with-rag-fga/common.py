"""Shared configuration for the permission-aware RAG example.

Reads settings from the environment, with an optional `.env` file next to
this module (KEY=VALUE lines; real env vars win). No python-dotenv needed.
"""

from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).parent
DOCS_DIR = HERE / "docs"

# FGA object naming: document:<filename>, e.g. "document:q3-financial-report.md".
DOCUMENT_TYPE = "document"
VIEW_RELATION = "can_view"

# Demo personas. Password is demo-only; it satisfies the strong-password policy.
DEMO_PASSWORD = "Demo@Pass123"
PERSONAS: dict[str, str] = {
    "alice": "alice@acme-demo.com",  # engineering team
    "bob": "bob@acme-demo.com",  # finance team
    "carol": "carol@acme-demo.com",  # org admin — sees everything
}


def _load_dotenv() -> None:
    env_file = HERE / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

AUTHORIZER_URL: str = os.environ.get("AUTHORIZER_URL", "http://localhost:8080")
AUTHORIZER_CLIENT_ID: str = os.environ.get("AUTHORIZER_CLIENT_ID", "")
AUTHORIZER_ADMIN_SECRET: str = os.environ.get("AUTHORIZER_ADMIN_SECRET", "")


def require(name: str, value: str) -> str:
    """Return value or exit with a clear message pointing at .env.example."""
    if not value:
        raise SystemExit(
            f"error: {name} is not set. Copy .env.example to .env and fill it in, "
            f"or export {name} in your shell."
        )
    return value
