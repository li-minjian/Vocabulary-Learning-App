# ADR 005 — Immutable dictionary installed during Docker build

Accepted and implemented 2026-11-02. Cloud publication/deployment require approval.

The existing validated English/German snapshot becomes a versioned zstd artifact.
`backend/dictionary.lock.json` pins compressed/database SHA-256, byte lengths,
source hashes, counts and licenses. Private GCS is the chosen distribution point;
GitHub Releases would introduce another distribution owner without improving this
Google-hosted backend. No upstream snapshot is refreshed by the image build.

The required build argument identifies the artifact. BuildKit mounts short-lived
ADC as a secret; credentials never enter image layers. The installer checks both
hashes, bounded decompression, SQLite integrity, indexes, source metadata and
language counts. A failed check fails the image build. Runtime runs as UID 10001,
uses read-only SQLite and does no download, reconstruction or RAM copy.

Public `/api/health/dictionary` checks installation, index/language/form presence,
metadata and pinned size/version. Full SHA/integrity/count verification belongs to
the build, avoiding a 613 MiB scan on each probe. Health never reveals paths.
Dictionary misses/unavailability never trigger AI. Updates require explicit new
version/checksums, review, artifact publication and image rebuild.

Consequences: images include a 642,834,432-byte immutable index, but instances do
not fetch it separately. SQLite pages/cache remain disk-backed. Clean builds need
read access to the published artifact; until approved publication, production
builds are blocked. See [deployment runbook](../PRODUCTION-UPGRADE.md).
