# Platform Roadmap Q3 (Engineering)

Internal engineering document. Access: engineering team.

## Q3 engineering priorities

The platform team ships three initiatives in Q3: migrating the event bus to
Kafka, rolling out the new deployment pipeline, and cutting p99 API latency
from 480ms to under 250ms.

## Kafka migration

The legacy RabbitMQ event bus reaches end of support in Q4. Migration happens
topic by topic, with dual-write during the transition. Target completion is
the last week of Q3.

## Deployment pipeline

The new pipeline builds container images once and promotes the same artifact
through staging and production. Rollbacks become a single-click operation.

## Latency program

Profiling showed 60% of p99 latency comes from N+1 queries in the reporting
service. The fix batches those lookups and adds a read-through cache.
