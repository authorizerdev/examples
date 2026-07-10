"""Permission-aware RAG CLI: retrieval filtered by Authorizer FGA.

    python rag.py --user alice "what is our Q3 revenue?"
    python rag.py --user bob --mode pre "what is our Q3 revenue?"

Two enforcement strategies (default: run both, with timings):
  post — rank the WHOLE corpus, then batch `check_permissions` on the
         retrieved candidates and drop what the user can't view.
  pre  — `list_permissions` fetches every document id the user can view,
         the corpus is filtered BEFORE ranking.

Everything FGA-related fails CLOSED: any Authorizer error aborts the run
rather than degrading to "everything is visible".
"""

from __future__ import annotations

import argparse
import re
import time
from dataclasses import dataclass

from rank_bm25 import BM25Okapi

from authorizer import (
    AuthorizerClient,
    CheckPermissionsRequest,
    ListPermissionsRequest,
    LoginRequest,
    PermissionCheckInput,
)
from authorizer.exceptions import AuthorizerConnectionError, AuthorizerError

from common import (
    AUTHORIZER_CLIENT_ID,
    AUTHORIZER_URL,
    DEMO_PASSWORD,
    DOCS_DIR,
    DOCUMENT_TYPE,
    PERSONAS,
    VIEW_RELATION,
    require,
)


@dataclass(frozen=True)
class Chunk:
    doc: str  # source filename, e.g. "q3-financial-report.md"
    text: str  # one paragraph


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    score: float
    allowed: bool


def load_corpus() -> list[Chunk]:
    """Split every docs/*.md into paragraph chunks."""
    chunks: list[Chunk] = []
    for path in sorted(DOCS_DIR.glob("*.md")):
        for para in path.read_text().split("\n\n"):
            text = " ".join(para.split())
            # Skip headings and access-banner boilerplate — they aren't answers.
            if not text or text.startswith("#") or text.lower().startswith(
                ("internal ", "confidential ", "welcome to")
            ):
                continue
            chunks.append(Chunk(doc=path.name, text=text))
    if not chunks:
        raise SystemExit(f"error: no documents found under {DOCS_DIR}")
    return chunks


def tokenize(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def rank(chunks: list[Chunk], query: str, k: int) -> list[tuple[Chunk, float]]:
    """BM25-rank chunks against the query; return the top k with score > 0."""
    bm25 = BM25Okapi([tokenize(c.text) for c in chunks])
    scores = bm25.get_scores(tokenize(query))
    ranked = sorted(zip(chunks, scores), key=lambda cs: cs[1], reverse=True)
    return [(c, float(s)) for c, s in ranked[:k] if s > 0]


class FgaGate:
    """The user's own view of FGA — every call authenticates as the end user.

    The server pins the permission subject from the bearer token, so this
    process holds no credential capable of asking for anyone else's view.
    """

    def __init__(self, client: AuthorizerClient, token: str) -> None:
        self._client = client
        self._headers = {"Authorization": f"Bearer {token}"}

    def check_documents(self, docs: list[str]) -> dict[str, bool]:
        """Batch check_permissions: doc filename -> allowed."""
        checks = [
            PermissionCheckInput(relation=VIEW_RELATION, object=f"{DOCUMENT_TYPE}:{d}")
            for d in docs
        ]
        try:
            res = self._client.check_permissions(
                CheckPermissionsRequest(checks=checks), headers=self._headers
            )
        except (AuthorizerError, AuthorizerConnectionError) as e:
            raise SystemExit(f"error: permission check failed (failing closed): {e}")
        prefix = f"{DOCUMENT_TYPE}:"
        return {r.object.removeprefix(prefix): bool(r.allowed) for r in res.results}

    def list_documents(self) -> set[str]:
        """list_permissions: every doc filename the user can view."""
        try:
            res = self._client.list_permissions(
                ListPermissionsRequest(relation=VIEW_RELATION, object_type=DOCUMENT_TYPE),
                headers=self._headers,
            )
        except (AuthorizerError, AuthorizerConnectionError) as e:
            raise SystemExit(f"error: permission listing failed (failing closed): {e}")
        if res.truncated:
            # A partial allow-list must never be mistaken for the full one.
            raise SystemExit("error: permission list truncated; refusing partial view")
        prefix = f"{DOCUMENT_TYPE}:"
        return {o.removeprefix(prefix) for o in res.objects}


def post_filter(gate: FgaGate, corpus: list[Chunk], query: str, k: int) -> list[Hit]:
    """Strategy A: rank everything, then check_permissions on the candidates."""
    t0 = time.perf_counter()
    candidates = rank(corpus, query, k)
    t_rank = time.perf_counter() - t0

    docs = sorted({c.doc for c, _ in candidates})
    t0 = time.perf_counter()
    allowed = gate.check_documents(docs) if docs else {}
    t_fga = time.perf_counter() - t0

    print(f"\n== Strategy A: post-filter (rank all {len(corpus)} chunks, then check) ==")
    print(f"   BM25 ranking: {t_rank * 1000:.1f} ms   "
          f"check_permissions ({len(docs)} unique docs, 1 batched call): {t_fga * 1000:.1f} ms")
    hits = [Hit(c, s, allowed.get(c.doc, False)) for c, s in candidates]
    _print_hits(hits)
    kept = [h for h in hits if h.allowed]
    if len(kept) < len(hits):
        print(f"   note: {len(hits) - len(kept)} of {len(hits)} candidates removed after "
              "retrieval — fewer than top-k survive (candidate starvation).")
    return kept


def pre_filter(gate: FgaGate, corpus: list[Chunk], query: str, k: int) -> list[Hit]:
    """Strategy B: list_permissions first, rank only what the user can view."""
    t0 = time.perf_counter()
    visible_docs = gate.list_documents()
    t_fga = time.perf_counter() - t0

    visible = [c for c in corpus if c.doc in visible_docs]
    t0 = time.perf_counter()
    candidates = rank(visible, query, k) if visible else []
    t_rank = time.perf_counter() - t0

    print(f"\n== Strategy B: pre-filter (list_permissions, then rank) ==")
    print(f"   list_permissions ({len(visible_docs)} visible docs): {t_fga * 1000:.1f} ms   "
          f"BM25 ranking over {len(visible)} permitted chunks: {t_rank * 1000:.1f} ms")
    hidden = sorted({c.doc for c in corpus} - visible_docs)
    if hidden:
        print(f"   excluded before ranking: {', '.join(hidden)}")
    hits = [Hit(c, s, True) for c, s in candidates]
    _print_hits(hits)
    return hits


def _print_hits(hits: list[Hit]) -> None:
    if not hits:
        print("   (no matching chunks)")
        return
    for i, h in enumerate(hits, 1):
        verdict = "ALLOWED" if h.allowed else f"DENIED  ({VIEW_RELATION}=false)"
        print(f"   {i}. [{h.score:5.2f}] {h.chunk.doc:<30} {verdict}")
        print(f"      \"{h.chunk.text[:100]}...\"")


def answer(hits: list[Hit]) -> None:
    """Extractive 'answer': the top permitted chunks, cited. Swap in an LLM
    here if you want generation — the authz story is identical."""
    print("\n== Answer (extractive, permitted chunks only) ==")
    if not hits:
        print("   No permitted document matches this question.")
        print("   (The relevant material may exist — this user simply cannot read it.)")
        return
    for h in hits[:2]:
        print(f"   {h.chunk.text}")
        print(f"   — source: {h.chunk.doc}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("query", help="the question to ask")
    parser.add_argument("--user", required=True, choices=sorted(PERSONAS),
                        help="persona to ask as")
    parser.add_argument("--mode", choices=["both", "post", "pre"], default="both",
                        help="FGA enforcement strategy (default: both)")
    parser.add_argument("--top-k", type=int, default=4, help="candidates to retrieve")
    args = parser.parse_args()

    client_id = require("AUTHORIZER_CLIENT_ID", AUTHORIZER_CLIENT_ID)
    corpus = load_corpus()

    client = AuthorizerClient(client_id, AUTHORIZER_URL)
    try:
        email = PERSONAS[args.user]
        try:
            login = client.login(LoginRequest(email=email, password=DEMO_PASSWORD))
        except (AuthorizerError, AuthorizerConnectionError) as e:
            raise SystemExit(
                f"error: login failed for {email}: {e}\n"
                "Is the server running and seeded? (python seed.py)"
            )
        if not login.access_token:
            raise SystemExit(f"error: login for {email} returned no access token")
        gate = FgaGate(client, login.access_token)

        print(f"user: {args.user} <{email}>   query: {args.query!r}")
        if args.mode in ("both", "post"):
            hits = post_filter(gate, corpus, args.query, args.top_k)
        if args.mode in ("both", "pre"):
            hits = pre_filter(gate, corpus, args.query, args.top_k)
        answer(hits)
    finally:
        client.close()


if __name__ == "__main__":
    main()
