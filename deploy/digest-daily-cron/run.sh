#!/bin/sh
set -eu

: "${BACKEND_PUBLIC_URL:?BACKEND_PUBLIC_URL is required}"
: "${INTERNAL_JOB_SHARED_SECRET:?INTERNAL_JOB_SHARED_SECRET is required}"

curl --fail --show-error --silent \
  -X POST \
  -H "X-Internal-Job-Secret: ${INTERNAL_JOB_SHARED_SECRET}" \
  "${BACKEND_PUBLIC_URL%/}/internal/reminders/run?mode=daily"
