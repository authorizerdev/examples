# Permission-aware RAG with Authorizer FGA (Python)

Your AI assistant must not leak documents the user can't read. This example
shows retrieval-augmented generation where **every retrieved chunk is gated by
Authorizer's fine-grained authorization** (embedded OpenFGA), using the
official Python SDK.

```
                 ┌───────────────┐
 query ──────►   │  BM25 ranking │──► candidates ──► FGA filter ──► answer
                 └───────────────┘                    │
                                          check_permissions (post)
                                          list_permissions  (pre)
```

## The two enforcement strategies

| | Strategy A: **post-filter** | Strategy B: **pre-filter** |
|---|---|---|
| How | Rank the whole corpus, then batch `check_permissions` on the candidates | `list_permissions` fetches every doc id the user can view; filter the corpus **before** ranking |
| Cost | One batched check per query (candidates only) | One list call; grows with the user's grant count |
| Failure mode | **Candidate starvation** — if the top-k are all denied, fewer (or zero) chunks survive | Large grant lists for privileged users |
| Use when | Corpus ≫ per-user access | Per-user access is small/medium |

`rag.py` runs **both** with timings so you can compare. Everything FGA-related
**fails closed** — an Authorizer error aborts the run rather than degrading to
"everything is visible".

> The content preview printed on `DENIED` rows is exactly what *would* have
> leaked without the filter — that's the demo's point. A real system must
> never render denied chunks anywhere (UI, logs, LLM prompt).

## Scopes vs FGA (why both exist)

OAuth scopes are the coarse ceiling stamped into the token at issuance
("may this client call the search API at all?"). FGA answers the per-object
question at request time ("may *this user* read *this document*?"). RAG needs
the second one.

## Quickstart

Requires an Authorizer server (any recent build; `make dev` in the server repo
serves :8080 with `--admin-secret=admin`).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env       # or export the two variables below
export AUTHORIZER_CLIENT_ID=kbyuFDidLLm280LIwVFiazOqjO3ty8KH   # make-dev default
export AUTHORIZER_ADMIN_SECRET=admin

.venv/bin/python seed.py   # personas + FGA model + tuples (idempotent)

.venv/bin/python rag.py --user alice "what is our Q3 revenue?"   # engineer: financials DENIED
.venv/bin/python rag.py --user bob   "what is our Q3 revenue?"   # finance: financials ALLOWED
.venv/bin/python rag.py --user carol "what is our Q3 revenue?"   # org admin: sees everything
.venv/bin/python rag.py --user alice --mode pre "kafka migration"
```

## What seed.py installs

- Personas: `alice` (engineering), `bob` (finance), `carol` (org admin)
- An FGA model with `org → team → document` inheritance:
  team members view their team's docs, org admins view everything
- 19 tuples over the 8 documents in `docs/` (specs, runbooks, financials,
  HR material)

## Files

- `rag.py` — the CLI: BM25 retrieval (`rank-bm25`), both FGA strategies,
  extractive answer from permitted chunks only (plug in your LLM where the
  summary is built — the authorization story is identical)
- `seed.py` — idempotent setup: users, `_fga_write_model`, `_fga_write_tuples`
- `common.py` — env config + personas
- `docs/` — the demo corpus

## SDK notes

Uses `authorizer-py` (PyPI) — `check_permissions` / `list_permissions` are
called with each persona's **own access token** (self-check path), exactly as
your application backend would.
