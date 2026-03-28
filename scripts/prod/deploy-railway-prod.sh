#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${RAILWAY_PROJECT_ID:-beee81ab-cf45-47ce-9289-d8a09a9984c2}"
ENVIRONMENT_NAME="${RAILWAY_ENVIRONMENT_NAME:-production}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-https://api.gustapp.ca/health}"
FRONTEND_URL="${FRONTEND_URL:-https://gustapp.ca}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
MAX_POLLS="${MAX_POLLS:-60}"
DRY_RUN="${DRY_RUN:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log() {
  printf '[deploy-railway-prod] %s\n' "$*"
}

fail() {
  printf '[deploy-railway-prod] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

railway_auth_mode() {
  if [[ -n "${RAILWAY_TOKEN:-}" ]]; then
    printf 'project-token\n'
  elif [[ -n "${RAILWAY_API_TOKEN:-}" ]]; then
    printf 'account-or-workspace-token\n'
  else
    printf 'missing\n'
  fi
}

require_railway_auth() {
  if [[ "$(railway_auth_mode)" == "missing" ]]; then
    fail "Missing Railway auth token. Set RAILWAY_TOKEN (preferred for CI/CD) or RAILWAY_API_TOKEN."
  fi
}

railway_cli() {
  if command -v railway >/dev/null 2>&1; then
    railway "$@"
  else
    npx @railway/cli "$@"
  fi
}

service_path() {
  case "$1" in
    backend) printf 'backend\n' ;;
    frontend) printf 'frontend\n' ;;
    digest-daily-cron) printf 'deploy/digest-daily-cron\n' ;;
    digest-weekly-cron) printf 'deploy/digest-weekly-cron\n' ;;
    *) fail "Unknown service: $1" ;;
  esac
}

service_needs_no_gitignore() {
  case "$1" in
    frontend) printf 'true\n' ;;
    *) printf 'false\n' ;;
  esac
}

default_services() {
  printf '%s\n' backend frontend digest-daily-cron digest-weekly-cron
}

parse_deployment_id() {
  sed -nE 's#.*id=([0-9a-f-]+).*#\1#p' | tail -n 1
}

poll_deployment() {
  local service="$1"
  local expected_deployment_id="$2"
  local attempt latest_json latest_id latest_status

  for ((attempt = 1; attempt <= MAX_POLLS; attempt += 1)); do
    latest_json="$(railway_cli deployment list -s "$service" -e "$ENVIRONMENT_NAME" --limit 1 --json)"
    latest_id="$(printf '%s' "$latest_json" | jq -r '.[0].id')"
    latest_status="$(printf '%s' "$latest_json" | jq -r '.[0].status')"

    log "${service}: deployment ${latest_id} status=${latest_status} (${attempt}/${MAX_POLLS})"

    if [[ "$latest_id" != "$expected_deployment_id" ]]; then
      sleep "$POLL_INTERVAL_SECONDS"
      continue
    fi

    case "$latest_status" in
      SUCCESS)
        return 0
        ;;
      FAILED|CRASHED|REMOVED|CANCELED)
        log "${service}: fetching build logs for failed deployment ${expected_deployment_id}"
        railway_cli logs --build -s "$service" "$expected_deployment_id" --lines 200 || true
        return 1
        ;;
      *)
        sleep "$POLL_INTERVAL_SECONDS"
        ;;
    esac
  done

  log "${service}: fetching build logs after timeout for deployment ${expected_deployment_id}"
  railway_cli logs --build -s "$service" "$expected_deployment_id" --lines 200 || true
  return 1
}

deploy_service() {
  local service="$1"
  local path no_gitignore_flag sha branch message output deployment_id

  path="$(service_path "$service")"
  no_gitignore_flag="$(service_needs_no_gitignore "$service")"
  sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  branch="$(git -C "$REPO_ROOT" branch --show-current || true)"
  message="deploy ${branch:-detached}@${sha} ${service}"

  log "Deploying ${service} from ${path}"

  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ "$no_gitignore_flag" == "true" ]]; then
      log "DRY RUN: railway up ${path} --path-as-root --no-gitignore -s ${service} -e ${ENVIRONMENT_NAME} -p ${PROJECT_ID}"
    else
      log "DRY RUN: railway up ${path} --path-as-root -s ${service} -e ${ENVIRONMENT_NAME} -p ${PROJECT_ID}"
    fi
    return 0
  fi

  if [[ "$no_gitignore_flag" == "true" ]]; then
    output="$(
      cd "$REPO_ROOT" &&
      railway_cli up "$path" --path-as-root --no-gitignore -s "$service" -e "$ENVIRONMENT_NAME" -p "$PROJECT_ID" -d -m "$message" 2>&1
    )"
  else
    output="$(
      cd "$REPO_ROOT" &&
      railway_cli up "$path" --path-as-root -s "$service" -e "$ENVIRONMENT_NAME" -p "$PROJECT_ID" -d -m "$message" 2>&1
    )"
  fi

  printf '%s\n' "$output"

  deployment_id="$(printf '%s\n' "$output" | parse_deployment_id)"
  [[ -n "$deployment_id" ]] || fail "Could not parse deployment id for ${service}"

  poll_deployment "$service" "$deployment_id" || fail "Deployment failed for ${service}"
}

verify_live_endpoints() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "DRY RUN: skipping live endpoint verification"
    return 0
  fi

  log "Verifying backend health endpoint"
  curl -fsS "$BACKEND_HEALTH_URL" >/dev/null || fail "Backend health check failed at ${BACKEND_HEALTH_URL}"

  log "Verifying frontend homepage"
  curl -fsS "$FRONTEND_URL" >/dev/null || fail "Frontend reachability check failed at ${FRONTEND_URL}"
}

main() {
  local current_branch service services=()

  require_command git
  require_command jq
  require_command curl

  cd "$REPO_ROOT"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "This script must run from within the gust-app repository"
  fi

  if [[ "$DRY_RUN" != "true" ]]; then
    require_railway_auth
    log "Using Railway auth mode: $(railway_auth_mode)"
  fi

  current_branch="$(git branch --show-current || true)"
  if [[ "${CI:-}" != "true" && "$current_branch" != "main" ]]; then
    fail "Refusing to deploy from branch '${current_branch:-detached}'. Switch to main or set CI=true."
  fi

  if [[ "$#" -gt 0 ]]; then
    services=("$@")
  else
    while IFS= read -r service; do
      services+=("$service")
    done < <(default_services)
  fi

  log "Using Railway project ${PROJECT_ID} (${ENVIRONMENT_NAME})"

  for service in "${services[@]}"; do
    deploy_service "$service"
  done

  verify_live_endpoints
  log "All requested Railway deployments completed successfully"
}

main "$@"
