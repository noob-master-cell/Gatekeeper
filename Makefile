.PHONY: dev-up dev-down test-all lint logs proxy-logs backend-logs install

# ──────────────────────────────────────────────
# Development
# ──────────────────────────────────────────────

dev-up:
	docker-compose -f infra/docker-compose.yml up --build -d

dev-down:
	docker-compose -f infra/docker-compose.yml down -v

logs:
	docker-compose -f infra/docker-compose.yml logs -f

proxy-logs:
	docker-compose -f infra/docker-compose.yml logs -f proxy

backend-logs:
	docker-compose -f infra/docker-compose.yml logs -f backend

# ──────────────────────────────────────────────
# Install
# ──────────────────────────────────────────────

install:
	cd gatekeeper-proxy && pip install -e ".[dev]"
	cd gatekeeper-backend && pip install -e ".[dev]"
	cd gatekeeper-control-plane && pip install -e ".[dev]"
	cd gatekeeper-dashboard && pnpm install

# ──────────────────────────────────────────────
# Testing
# ──────────────────────────────────────────────

test-proxy:
	cd gatekeeper-proxy && python -m pytest tests/ -v

test-backend:
	cd gatekeeper-backend && python -m pytest tests/ -v

test-control-plane:
	cd gatekeeper-control-plane && python -m pytest tests/ -v

test-dashboard:
	cd gatekeeper-dashboard && pnpm test

test-all: test-proxy test-backend test-control-plane

# ──────────────────────────────────────────────
# Linting
# ──────────────────────────────────────────────

lint-proxy:
	cd gatekeeper-proxy && ruff check . && mypy app/

lint-backend:
	cd gatekeeper-backend && ruff check . && mypy app/

lint-control-plane:
	cd gatekeeper-control-plane && ruff check . && mypy app/

lint-dashboard:
	cd gatekeeper-dashboard && pnpm lint

lint: lint-proxy lint-backend lint-control-plane

# ──────────────────────────────────────────────
# Formatting
# ──────────────────────────────────────────────

fmt:
	cd gatekeeper-proxy && ruff format .
	cd gatekeeper-backend && ruff format .
	cd gatekeeper-control-plane && ruff format .
