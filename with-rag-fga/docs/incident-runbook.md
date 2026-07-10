# Incident Response Runbook (Engineering)

Internal engineering document. Access: engineering team.

## Severity levels

SEV1 means customer-facing outage, page the on-call engineer immediately.
SEV2 means degraded service, respond within 30 minutes. SEV3 means internal
tooling issues, handle during business hours.

## On-call rotation

The on-call rotation is weekly and managed in the paging tool. Handover
happens every Monday at 09:00 UTC with a written summary of open incidents.

## Database failover

If the primary Postgres instance fails, the replica in the secondary region
is promoted automatically within 60 seconds. Verify replication lag before
re-enabling writes. Never promote manually without checking the WAL position.

## Postmortems

Every SEV1 and SEV2 incident gets a blameless postmortem within five business
days, including a timeline, root cause, and at least one prevention action.
