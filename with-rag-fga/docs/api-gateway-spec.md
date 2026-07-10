# API Gateway Specification (Engineering)

Internal engineering document. Access: engineering team.

## Overview

The Acme API gateway terminates TLS, authenticates requests, and routes
traffic to internal services. It runs as three replicas behind the load
balancer in each region.

## Authentication

Every inbound request must carry a JWT issued by the identity service. The
gateway validates the signature against the JWKS endpoint and rejects tokens
older than 15 minutes. Service-to-service calls use mTLS with SPIFFE
identities.

## Rate limiting

Default rate limit is 1000 requests per minute per API key, enforced with a
sliding window in Redis. Partners on the enterprise plan get 10000 requests
per minute.

## Routing

Routes are declared in the gateway config repository. A change to routing
requires review from two gateway maintainers and passes through the staging
environment for one hour of canary traffic before production rollout.
