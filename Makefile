SHELL := /bin/sh

BACKEND_VENV := backend/.venv
BACKEND_PYTHON := $(BACKEND_VENV)/bin/python
BACKEND_PIP := $(BACKEND_VENV)/bin/pip
SUPABASE := npx supabase@latest
DEV_RUNTIME_DIR := .dev-runtime
DEV_RUNTIME_ENV := $(DEV_RUNTIME_DIR)/runtime.env
DEV_SUPABASE_DIR := $(DEV_RUNTIME_DIR)/supabase
DEV_SUPABASE_WORKDIR := $(DEV_RUNTIME_DIR)
DOCKER_COMPOSE := docker compose --env-file $(DEV_RUNTIME_ENV)

.PHONY: frontend-install backend-install install frontend-lint frontend-test frontend-build backend-lint backend-test backend-smoke check prepare-dev-runtime supabase-start supabase-stop wait-backend app-up app-down dev local dev-up local-down dev-down dev-local

frontend-install:
	npm --prefix frontend install

backend-install:
	@if command -v uv >/dev/null 2>&1; then \
		uv sync --project backend --extra dev; \
	else \
		test -d "$(BACKEND_VENV)" || python3 -m venv "$(BACKEND_VENV)"; \
		"$(BACKEND_PIP)" install --upgrade pip; \
		"$(BACKEND_PIP)" install -e './backend[dev]'; \
	fi

install: frontend-install backend-install

frontend-lint:
	npm --prefix frontend run lint

frontend-test:
	npm --prefix frontend run test

frontend-build:
	npm --prefix frontend run build

backend-lint:
	@if command -v uv >/dev/null 2>&1; then \
		uv run --project backend ruff check backend/app backend/tests; \
	else \
		"$(BACKEND_VENV)/bin/ruff" check backend/app backend/tests; \
	fi

backend-test:
	@if command -v uv >/dev/null 2>&1; then \
		APP_ENV=test DATABASE_URL=sqlite+pysqlite:///:memory: RUN_STARTUP_CHECKS=false uv run --project backend pytest; \
	else \
		APP_ENV=test DATABASE_URL=sqlite+pysqlite:///:memory: RUN_STARTUP_CHECKS=false "$(BACKEND_VENV)/bin/pytest"; \
	fi

backend-smoke:
	@if command -v uv >/dev/null 2>&1; then \
		cd backend && APP_ENV=test DATABASE_URL=sqlite+pysqlite:///:memory: RUN_STARTUP_CHECKS=false uv run python -c "from app.core.app import create_app; create_app()"; \
	else \
		cd backend && APP_ENV=test DATABASE_URL=sqlite+pysqlite:///:memory: RUN_STARTUP_CHECKS=false ../"$(BACKEND_PYTHON)" -c "from app.core.app import create_app; create_app()"; \
	fi

check: frontend-lint frontend-test frontend-build backend-lint backend-test backend-smoke

prepare-dev-runtime:
	python3 scripts/dev/prepare-runtime.py

supabase-stop:
	@if [ -d "$(DEV_SUPABASE_DIR)" ]; then \
		$(SUPABASE) stop --workdir "$(DEV_SUPABASE_WORKDIR)"; \
	fi

supabase-start: prepare-dev-runtime
	@set -a; \
	. "$(DEV_RUNTIME_ENV)"; \
	set +a; \
	$(SUPABASE) start --workdir "$(DEV_SUPABASE_WORKDIR)"

app-up: prepare-dev-runtime
	$(DOCKER_COMPOSE) up -d --build backend
	$(MAKE) wait-backend
	$(DOCKER_COMPOSE) up -d frontend

wait-backend:
	@. "$(DEV_RUNTIME_ENV)"; \
	printf 'Waiting for backend health check on http://localhost:%s/health ...\n' "$$GUST_BACKEND_PORT"; \
	attempts=0; \
	until curl -fsS "http://localhost:$$GUST_BACKEND_PORT/health" 2>/dev/null | grep -q '"status":"ok"'; do \
		attempts=$$((attempts + 1)); \
		if [ $$attempts -ge 60 ]; then \
			echo 'Backend did not become healthy within 60 seconds.'; \
			$(DOCKER_COMPOSE) logs --tail=50 backend; \
			exit 1; \
		fi; \
		sleep 1; \
	done

app-down:
	@if [ -f "$(DEV_RUNTIME_ENV)" ]; then \
		$(DOCKER_COMPOSE) down; \
	else \
		docker compose down; \
	fi

dev-local: supabase-start app-up
	@. "$(DEV_RUNTIME_ENV)"; \
	printf '%s\n' \
		'Local dev stack is ready:' \
		"  frontend: http://localhost:$$GUST_FRONTEND_PORT" \
		"  backend: http://localhost:$$GUST_BACKEND_PORT" \
		"  supabase api: http://localhost:$$GUST_SUPABASE_API_PORT" \
		"  supabase studio: http://localhost:$$GUST_SUPABASE_STUDIO_PORT"

dev: dev-local

local: dev-local

dev-up: dev-local

local-down: app-down supabase-stop
	rm -rf "$(DEV_RUNTIME_DIR)"

dev-down: local-down
