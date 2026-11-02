# ADR 006 — Private direct uploads and local PDF extraction

Accepted and implemented 2026-11-02. GCS/IAM/deployment remain approval-gated.

Cloud Run's HTTP/1 request limit is 32 MiB. All selected files therefore use a
small authenticated authorization request, a 10-minute exact-size signed GCS POST,
then a small authenticated processing request. A shared policy permits exactly
52,428,800 bytes. The local filesystem PUT provider is development-only and
refuses to run when `K_SERVICE` identifies Cloud Run.

Backend-owned keys contain a user hash and random ID. Signed metadata binds the
user, workflow, type, size and expiry. Processing checks actual object metadata,
generation and content, claims a conditional lease and downloads that generation.
Receipts make processing retries idempotent; mapping and database import still
require explicit confirmation and keep the existing import IDs/row retry model.

Ordinary PDFs use bounded Poppler subprocesses, no model. Unusable text offers a
separate explicit AI action only within 20 MiB/100 pages, with provider file upload
and best-effort deletion. The base64 extraction endpoint is retired (410).
List/APKG imports never invoke AI. APKG only reads the selected bounded collection
DB; unused media is never extracted, decoded or executed.

One parse runs per Gunicorn process. Time/CPU/address-space/result limits keep
work within synchronous Cloud Run requests; no queue or second service is justified.
Successful processing deletes its source, while scan inputs remain for explicit
OCR. Cancellation is best effort; already signed capabilities cannot be revoked
individually and may create an orphan until expiry/lifecycle deletion. Application
access expires after one hour; GCS deletes the `voca/tmp/` prefix after one day
(asynchronous lifecycle, not an exact deletion SLA). Receipts expire too.

Consequences: a private bucket, narrow IAM signing permission and approved-origin
CORS are prerequisites. Direct transfers avoid Flask's HTTP/1 upload limit. Upload
retry restarts the transfer; completed transfers retry processing without reupload.
See [deployment runbook](../PRODUCTION-UPGRADE.md) for configuration and limits.
