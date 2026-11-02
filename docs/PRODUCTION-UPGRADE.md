# Dictionary delivery and 50 MiB upload runbook

Status, 2026-11-02: **Production deployed; acceptance PARTIAL only for authenticated
Cloud Run/browser verification**, explicitly deferred by the user because no
dedicated test account is available. Real private GCS uploads and production public
health/browser checks passed. No existing application records, schema or RLS changed.
The user authorized the resource/IAM/runtime/traffic changes in this release.
The current branch continues the work from [PR #5](https://github.com/li-minjian/Vocabulary-Learning-App/pull/5).
PR #5 was already merged on 2026-11-01; this upgrade was merged through
[PR #6](https://github.com/li-minjian/Vocabulary-Learning-App/pull/6) as
`c65052d193edd0da84a39520336cf120f67ded46` after staged backend acceptance.

## Actual production release and rollback

Canonical sanitized evidence: [production release](qa/production-release-2026-11-02.json).

| Component | Actual release |
| --- | --- |
| Private artifact bucket | `voca-497321-dictionary-171081604096`, europe-west1, uniform access + PAP enforced |
| Private upload bucket | `voca-497321-uploads-171081604096`, europe-west1, uniform access + PAP enforced |
| Artifact | `gs://voca-497321-dictionary-171081604096/dictionary/2026-11-01.1/voca-dictionary-2026-11-01.1.sqlite3.zst` |
| Artifact generation | `1793627816400999`; 79,029,124 bytes, verified by build download against the locked SHA |
| Cloud Run production revision | `vocabulary-learning-app-voca-7f63aa8`, 100% traffic |
| Image source | `7f63aa8fd8c804c42a1d980041e52a89087040d0` |
| Immutable image | `europe-west1-docker.pkg.dev/voca-497321/cloud-run-source-deploy/vocabulary-learning-app/vocabulary-learning-app@sha256:5ce921d2add7094c72c6309211cc14fa9b80b5e00d7648c2f54c799d7e2fe66f` |
| Runtime | 1 CPU / 1 GiB / concurrency 8 / min 0 / max 2 / 300s request timeout |
| Runtime/signing identity | `voca-runtime@voca-497321.iam.gserviceaccount.com` |
| Vercel production | `dpl_BU7qLcRVdu42wo7VxX55wkaoHMMV`, READY, merge commit `c65052d193edd0da84a39520336cf120f67ded46` |
| Public domain | https://voca118.vercel.app — unchanged |

Production and preview Vercel environments already share the configured backend
URL. Backend was staged at 0%, verified, then promoted before the frontend release.
Vercel rejected direct preview promotion (422); the existing Git main production
pipeline was used successfully instead. Domain metadata and served JavaScript
were checked after release: correct Cloud Run URL, 50 MiB policy and GCS client.

The prior observed rollback pair is retained:

- Cloud Run `vocabulary-learning-app-00030-c95`, image digest
  `sha256:6408ffe574e2f63e738c728f25d0dd1899069ef9f42c8b615c413c18398974b5`.
- Vercel `dpl_Hd7KTfknpsGz3FpjWXafwfeNx5ys`,
  `https://voca-d55k82pbl-min-s-projects118.vercel.app`, commit
  `368d3fa63861391eac278c84ca39fdcdaffc68d8`.

Restore both together if a critical regression occurs:

```bash
gcloud run services update-traffic vocabulary-learning-app --project=voca-497321 \
  --region=europe-west1 --to-revisions=vocabulary-learning-app-00030-c95=100
```

Then request Vercel Instant Rollback for project `prj_JwFkAq4kAEPRzgLRXypFTytSgXHd`
to `dpl_Hd7KTfknpsGz3FpjWXafwfeNx5ys` (the connected `request_rollback` tool or
Vercel deployment dashboard). Recheck both health and domain metadata. No rollback
was executed; references/old images were preserved. This is the observed prior
pair, not a claim that its older backend supported every PR #5 frontend feature.
Do not delete dictionary artifacts or user data during rollback.

Actual cloud checks: ready200, auth401, exact-origin CORS, Supabase settings200,
unchanged prior environment values and zero observed ERROR log entries. Available
memory telemetry after health requests was about 12–13% of 1 GiB; this is not a
large-file parsing peak measurement. The published image independently passed
offline English/German lookup, misses, non-root and absent-build-token checks.

Real GCS checks used the runtime identity: signed upload, wrong key/size, stale
generation, wrong owner, application expiry and expired signature, duplicate
processing, cancellation, CSV/TSV/TXT, exactly 50 MiB CSV/PDF/APKG and a rejected
52,428,801-byte upload. Parsing ran in production service code locally against
real GCS, **not through an authenticated Cloud Run request**. A stuck scan lease
was found and fixed: GCS PATCH requires explicit `processing: null` to remove the
metadata key. The targeted cloud retest confirmed immediate re-claim and cleanup;
only exact recorded synthetic objects were removed. Ordinary paths made no AI calls.

Public Chrome checks covered login, protected redirects, mobile overflow and
runtime errors. Dashboard/private CRUD, authenticated dictionary/processing,
Save-to-Vocabulary and Review/SRS remain unverified online. The user explicitly
accepted this gap; no personal JWT, personal account or auth bypass was used.

Antigravity recovery is **COMPLETE**: official PowerShell 7.6.9 ARM64 user install,
then real Flash Medium and a fresh-process default-discovery Flash Low result,
both `WORKER_SUCCEEDED/PASS`. See [execution evidence](qa/antigravity-recovery-2026-11-02.json).
These pure-read tasks do not establish untested controlled-write broker behavior.

## Approval boundary and observed service

Read-only inspection identified project `voca-497321`, Cloud Run service
`vocabulary-learning-app`, region `europe-west1`: 1 CPU, 512 MiB RAM, concurrency
80, timeout 300 seconds. No change was applied. Frontend remains Vercel; application
data/auth remain Supabase. No schema/RLS changes are required.

The authorized deployment applied these prerequisites (templates retained below
for future reproducibility):

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
5. Build/push a `linux/amd64` image using short-lived build credentials, stage at
   zero traffic, check public health and real GCS, then promote. A dedicated user
   was unavailable, so authenticated Cloud Run verification remains deferred.
   Applied settings are 1 CPU / **1 GiB**, concurrency **8**, min instances 0,
   max instances 2, existing 300-second timeout. This is headroom for bounded PDF/APKG processing
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

The validated existing snapshot was packaged and **published privately** at the
versioned object above; source snapshots were not refreshed. The local copy is
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

Templates are in `deploy/gcs/`. Applied custom roles are `vocaDictionaryReader`,
`vocaTemporaryUploads`, `vocaUploadSigner`, `vocaArtifactPublisher` and
`vocaBuildToken`. Runtime, builder and publisher are separate service accounts.
No new Owner/Editor grant or service-account key was created. Existing deployment
administrator permissions were left unchanged. Temporary deployment-user token
permission on the runtime account was removed after real-GCS checks.

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

Reproduction templates (actual chosen names and results are recorded above):

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
  --build-arg GCP_PROJECT=voca-497321 \
  --build-arg "DICTIONARY_ARTIFACT_URL=gs://${VOCA_ARTIFACT_BUCKET}/dictionary/2026-11-01.1/voca-dictionary-2026-11-01.1.sqlite3.zst" \
  -t "${VOCA_APPROVED_IMAGE}" backend
```

The executed build used a restricted, one-hour `voca-image-builder` OAuth token
mounted as `gcp_access_token`, not a downloadable service-account key. ADC remains
supported. The equivalent build selects `--secret id=gcp_access_token,src=...` and
`--build-arg GCP_PROJECT=voca-497321`. Only the deployment caller gets
`iam.serviceAccounts.getAccessToken` on builder/publisher accounts, not project-wide
Token Creator. Registry writer is scoped to the existing repository. Token files
and isolated Docker login config were removed after successful push. Immutable
artifact installation now precedes application COPY, so normal code changes can
reuse the dictionary layer without another download.

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

Remaining authenticated acceptance: use a dedicated test user from Vercel
to upload exactly 50 MiB, verify GCS stored bytes and generation, finalize, confirm
an import, repeat finalization, test wrong-user/expiry/cancel and verify lifecycle.
No fixture test is a substitute for this actual cloud verification.
