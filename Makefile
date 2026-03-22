SHELL := /bin/sh

BACKEND_VENV := backend/.venv
BACKEND_PYTHON := $(BACKEND_VENV)/bin/python
BACKEND_PIP := $(BACKEND_VENV)/bin/pip
SUPABASE := npx supabase@latest

.PHONY: frontend-install backend-install install frontend-lint frontend-test frontend-build backend-lint backend-test backend-smoke check supabase-start supabase-stop app-up app-down dev-up dev-down

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

supabase-start:
	$(SUPABASE) start

supabase-stop:
	$(SUPABASE) stop

app-up:
	docker compose up --build -d frontend backend

app-down:
	docker compose down

dev-up: install supabase-start app-up

dev-down: app-down supabase-stop
