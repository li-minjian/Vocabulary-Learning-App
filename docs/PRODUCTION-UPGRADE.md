# Dictionary delivery and 50 MiB upload runbook

Status, 2026-11-02: **Implemented and locally verified. Not cloud-verified.**
No buckets, IAM bindings, secrets, environment files or production deployments
were changed. Commands below are operator templates requiring separate approval.
The current branch continues the work from [PR #5](https://github.com/li-minjian/Vocabulary-Learning-App/pull/5).
GitHub inspection found #5 already merged on 2026-11-01; this upgrade is in
[draft PR #6](https://github.com/li-minjian/Vocabulary-Learning-App/pull/6) from the
same feature branch. It is not part of that earlier merge.

## Approval boundary and observed service

Read-only inspection identified project `voca-497321`, Cloud Run service
`vocabulary-learning-app`, region `europe-west1`: 1 CPU, 512 MiB RAM, concurrency
80, timeout 300 seconds. No change was applied. Frontend remains Vercel; application
data/auth remain Supabase. No schema/RLS changes are required.

Approve these concrete steps before enabling production:

1. Create two dedicated **private** Standard GCS buckets in `europe-west1`: one
   immutable versioned dictionary-artifact bucket and one temporary upload bucket.
   Operator chooses globally unique names. No public grants. Enforce uniform
   access and public access prevention. For the new temporary-only bucket, disable
   object versioning and soft deletion to avoid retaining cancelled inputs; this
   is an explicit retention choice, not a change to any existing bucket.
2. Publish the verified 79,029,124-byte artifact and lock manifest under
   `dictionary/2026-11-01.1/` with create-only generation preconditions.
3. Assign the narrow permissions below; enable IAM Service Account Credentials
   API if needed. Use a dedicated approved runtime/signing identity and CI identity.
4. Apply approved-origin CORS and one-day lifecycle, then supply runtime settings
   `UPLOAD_PROVIDER=gcs`, `UPLOAD_BUCKET`, `UPLOAD_SIGNER_EMAIL` through the
   normal approved environment-management process. Do not edit secret files.
5. Build/push a `linux/amd64` image using short-lived build credentials. After
   separate deployment approval, deploy the image and verify the actual GCS/CORS/
   signing/Cloud Run path with a dedicated test user. Recommended initial resource
   settings are 1 CPU / **1 GiB**, concurrency **8**, min instances 0, max instances
   2, existing 300-second timeout. This is headroom for bounded PDF/APKG processing
   and tmpfs, not an assumption that the dictionary must be loaded into RAM.

## Pinned dictionary and publication

The source snapshot and its attribution remain in [DICTIONARY.md](DICTIONARY.md).
`backend/dictionary.lock.json` is the canonical distribution lock:

| Field | Value |
| --- | --- |
| Version | `2026-11-01.1` |
| English / German records | 770,611 / 371,793 |
| SQLite bytes | 642,834,432 |
| SQLite SHA-256 | `893f501a96e431386a3025d74629feffff477d5ca44c439d2668ff96b99a031c` |
| Artifact bytes | 79,029,124 |
| Artifact SHA-256 | `760f954052a785fe5b19295ff89ea0041dd2f3dbea49d3ce9f884b411296bfc1` |

The validated existing snapshot was packaged locally, **not published**. In this
session the staged artifact is
`backend/data/dictionary/voca-dictionary-2026-11-01.1.sqlite3.zst` (Git-ignored).
Archive that release output in approved storage; a local checkout is not cloud
distribution. Production builds use the published GCS object and Git lock only,
with no dependency on the Mac. Reproduce packaging using retained snapshot files:

```bash
backend/.venv/bin/python backend/scripts/dictionary_artifact.py package \
  --database backend/data/dictionary/dictionary.sqlite3 \
  --snapshot-manifest backend/data/dictionary/dictionary.manifest.json \
  --version 2026-11-01.1 --output /tmp/voca-dictionary-release \
  --lockfile /tmp/voca-dictionary-release.lock.json
```

Review that the produced lock matches the checked-in hashes. After approval,
publish using operator-selected bucket variables (never a public bucket):

```bash
gcloud storage cp --if-generation-match=0 \
  /tmp/voca-dictionary-release/voca-dictionary-2026-11-01.1.sqlite3.zst \
  "gs://${VOCA_ARTIFACT_BUCKET}/dictionary/2026-11-01.1/"
gcloud storage cp --if-generation-match=0 /tmp/voca-dictionary-release/dictionary.lock.json \
  "gs://${VOCA_ARTIFACT_BUCKET}/dictionary/2026-11-01.1/"
```

For an update, explicitly obtain/review new source snapshots, run the source
installer, choose a **new** `--version`, package, review counts/licenses/hashes,
replace the Git lock, publish create-only, rebuild and reverify. Never silently
refresh upstream sources or overwrite an approved version. Compression is pinned
by `zstandard==0.25.0`; changing tooling can change artifact bytes and requires review.

## IAM, bucket policy and CORS templates

Templates are in `deploy/gcs/`. IAM custom roles require operator creation and
binding; none have been created by this task.

| Identity | Permission / scope |
| --- | --- |
| Publisher | `storage.objects.create` on the artifact bucket; no overwrite/delete |
| CI builder | `dictionary-build-role.json`: `storage.objects.get`, bound to artifact bucket with condition `resource.name.startsWith('projects/_/buckets/BUCKET/objects/dictionary/2026-11-01.1/')` |
| Runtime (also signer) | `upload-role.json`, bound **only** to the dedicated upload bucket: bucket metadata get and object create/get/update/delete; no listing/admin |
| Runtime signing caller | `sign-role.json`: only `iam.serviceAccounts.signBlob`, bound **only** to that signing service account (self-binding if runtime and signer are the same identity) |

The signer itself must have `storage.objects.create` on the upload bucket; using
the same dedicated runtime identity supplies this without a second principal.
No Storage Admin, Editor, downloadable service-account key or broad Token Creator
role is needed. Build credentials use Workload Identity Federation or another
approved short-lived ADC file passed as a BuildKit secret; do not bake ADC into COPY,
build args, environment layers or logs.

Example new-bucket configuration commands, **not executed**:

```bash
gcloud storage buckets create "gs://${VOCA_UPLOAD_BUCKET}" --project=voca-497321 \
  --location=europe-west1 --uniform-bucket-level-access \
  --public-access-prevention --soft-delete-duration=0
gcloud storage buckets update "gs://${VOCA_UPLOAD_BUCKET}" --no-versioning \
  --cors-file=deploy/gcs/upload-cors.json \
  --lifecycle-file=deploy/gcs/upload-lifecycle.json
gcloud storage buckets create "gs://${VOCA_ARTIFACT_BUCKET}" --project=voca-497321 \
  --location=europe-west1 --uniform-bucket-level-access --public-access-prevention
```

CORS permits only `https://voca118.vercel.app` and POST. Add another exact origin
only after approval; do not use `*` or authorize all Vercel previews. Bucket public
access prevention and uniform access are checked by the application before signing.
GCS lifecycle is asynchronous: inputs/receipts become inaccessible to the app after
one hour and are eligible for bucket deletion after one day, not exactly at 24h.

## Clean image build and readiness

Build from backend context. `.dockerignore` excludes environment files, local
source datasets/SQLite, virtualenv, tests and bytecode. Python base digest, Poppler
package and complete Python dependency versions are pinned. OS repositories are
not a frozen Debian snapshot: an unavailable pinned package fails the build and
requires an explicit reviewed pin refresh; byte-identical OCI images are not claimed.

```bash
docker build --platform linux/amd64 \
  --secret id=gcp_adc,src="${VOCA_BUILD_ADC_FILE}" \
  --build-arg "DICTIONARY_ARTIFACT_URL=gs://${VOCA_ARTIFACT_BUCKET}/dictionary/2026-11-01.1/voca-dictionary-2026-11-01.1.sqlite3.zst" \
  -t "${VOCA_APPROVED_IMAGE}" backend
```

The installer pins the GCS generation, checks compressed size/hash, bounds expansion,
checks SQLite size/hash/integrity/indexes/counts/source metadata and installs only
read-only SQLite plus its lock under `/opt/voca/dictionary`. Credentials remain in
the secret mount. Missing/wrong artifacts fail the build. Startup only launches
Gunicorn: one worker, four threads, 180-second request timeout. No startup download,
upstream fetch, index rebuild or full dictionary RAM copy occurs.

Public `GET /api/health/dictionary` returns 200 with `ready`, version, expected
counts and artifact SHA; missing/corrupt/incompatible installs return 503 with a
generic diagnostic. Use this path for a Cloud Run HTTP startup probe. Ordinary
dictionary APIs still require authentication. A separate liveness probe may use
`/api/health`; it does not prove dictionary readiness. No response includes paths.

## Transfer, validation, expiry and processing budgets

[Cloud Run quotas](https://docs.cloud.google.com/run/quotas) cap HTTP/1 request
bodies at 32 MiB. The production browser never proxies file bytes through Flask:

1. Authenticated `POST /api/uploads` supplies filename, byte size, workflow.
2. Backend returns a [V4 signed POST policy](https://docs.cloud.google.com/storage/docs/xml-api/post-object-forms)
   binding exact server-generated key, MIME, ownership metadata and exact byte
   length for 10 minutes. Only policy fields go to GCS; Supabase JWT stays on API requests.
3. Browser XHR uploads directly to GCS with progress and cancellation. Failed
   transfers retry from the start. Completed uploads retry processing without retransmission.
4. `POST /api/uploads/:id/process` checks user/workflow, expiry, actual size/type,
   generation and magic bytes. A conditional metadata lease prevents simultaneous
   processing. Download uses `if_generation_match`; receipts preserve retry results.
5. List preview proceeds through existing mapping/duplicate/collection/explicit
   confirm APIs. Processing alone does not write application user data.
6. Success deletes the input. Scan inputs remain for optional explicit AI. DELETE
   is best effort on cancel; signed POST capabilities can still be reused until
   expiry, and lifecycle cleans up late/interrupted objects and receipts.

| Budget | Limit / behavior |
| --- | --- |
| File bytes | 1–52,428,800; rejects zero and +1 before parsing |
| Init/process JSON | 16 KiB |
| Existing preview/commit/paste controls | 12 MiB; selected files always use direct upload |
| Parsing concurrency | One per Gunicorn process; busy request returns 429, no queue |
| CSV/APKG parser | 60s wall / 45s CPU / 768 MiB address space on Linux; preview at most 24 MiB UTF-8 |
| APKG collection | 100 MiB decoded DB, 10,000 notes, 64 columns, 20,000 chars/cell; SQLite progress budget |
| APKG archive | 20,000 entries, safe paths, no encrypted content; only collection DB is read, media ignored |
| PDF | 200 pages, 100,000 text characters; pdfinfo 15s, pdftotext 45s / 30s CPU / 512 MiB address space; 1 MiB output file |
| Explicit AI | Only after unusable local extraction; 20 MiB, 100 pages, 120s outer timeout; no automatic retry/model fallback |
| Processing lease / application access | 300s lease; one-hour input/receipt expiry |

PDF text stays in the existing Article Import editor; save for Reading & Typing
does not analyze vocabulary. Multi-column/table reading order may need correction.
Images/scans request no AI until the separate labeled button is clicked. Provider
file deletion is attempted in `finally`; forced process termination can prevent
confirmation, so provider-side retention rules still apply. Real paid OCR has not
been called in verification. All oversized/unsupported processing states instruct
the user to split or simplify; parser limits are independent of the upload limit.

## Cost and troubleshooting

The immutable 613 MiB index increases image size, not per-start external downloads.
Compressed distribution is about 75.4 MiB. SQLite reads indexed pages on demand.
One temporary bucket adds small storage/request charges, bounded per file by
50 MiB with prompt success deletion and a one-day cleanup rule. Same-region storage
avoids cross-region placement. No always-on worker, queue or second application DB;
min instances 0 and max 2 bound idle/scale costs. Ordinary dictionary, list and
text-PDF paths make zero model calls. Price totals depend on usage and current
[Cloud Storage](https://cloud.google.com/storage/pricing) /
[Cloud Run](https://cloud.google.com/run/pricing) rates; no unmeasured monthly saving is claimed.

- Build SHA failure: wrong object/version or corrupted transfer. Do not bypass the
  lock; compare both hashes and approved generation. Never redownload latest sources automatically.
- Upload 503: check bucket/settings, PAP/uniform access, metadata-get permission,
  ADC and signer `signBlob` permission. Check IAM Credentials API availability.
- Browser CORS failure: verify exact origin and bucket POST CORS, independently of Flask CORS.
- Upload 410: retry; browser discards the expired ticket. 409/429: wait briefly and retry processing.
- 422 resource error: split PDF/deck/list. A file within 50 MiB can exceed content budgets.
- Local PDF 503: install Poppler utilities; Docker already includes the pinned package.

Remaining cloud acceptance after approval: use a dedicated test user from Vercel
to upload exactly 50 MiB, verify GCS stored bytes and generation, finalize, confirm
an import, repeat finalization, test wrong-user/expiry/cancel and verify lifecycle.
No fixture test is a substitute for this actual cloud verification.
