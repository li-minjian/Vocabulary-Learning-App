# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337

WORKDIR /app

RUN apt-get update -qq && apt-get install -y --no-install-recommends poppler-utils=22.12.0-2+deb12u3 \
    && rm -r /var/lib/apt/lists/*
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock

COPY . .

ARG DICTIONARY_ARTIFACT_URL
ARG ALLOW_LOCAL_DICTIONARY_HTTP=0
ARG GCP_PROJECT
RUN --mount=type=secret,id=gcp_adc --mount=type=secret,id=gcp_access_token \
    set -eu; \
    if [ -f /run/secrets/gcp_adc ]; then export GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp_adc; fi; \
    set --; \
    if [ "$ALLOW_LOCAL_DICTIONARY_HTTP" = 1 ]; then set -- --allow-local-http; fi; \
    if [ -f /run/secrets/gcp_access_token ]; then set -- "$@" --access-token-file /run/secrets/gcp_access_token; fi; \
    GOOGLE_CLOUD_PROJECT="$GCP_PROJECT" python scripts/dictionary_artifact.py install --url "$DICTIONARY_ARTIFACT_URL" \
      --lockfile dictionary.lock.json --destination /opt/voca/dictionary "$@"

EXPOSE 8080

ENV FLASK_HOST=0.0.0.0
ENV FLASK_DEBUG=false
ENV PORT=8080
ENV DICTIONARY_PATH=/opt/voca/dictionary/dictionary.sqlite3
ENV DICTIONARY_MANIFEST=/opt/voca/dictionary/dictionary.lock.json
ENV UPLOAD_PROVIDER=gcs
USER 10001:10001

CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 180 app:app"]
