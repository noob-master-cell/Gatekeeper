.PHONY: dev-up dev-down test-all lint logs proxy-logs backend-logs install certs smoke

# ──────────────────────────────────────────────
# Development
# ──────────────────────────────────────────────

dev-up:
	docker compose -f infra/docker-compose.yml up --build -d

dev-down:
	docker compose -f infra/docker-compose.yml down -v

logs:
	docker compose -f infra/docker-compose.yml logs -f

proxy-logs:
	docker compose -f infra/docker-compose.yml logs -f proxy

backend-logs:
	docker compose -f infra/docker-compose.yml logs -f backend

cp-logs:
	docker compose -f infra/docker-compose.yml logs -f control-plane

# ──────────────────────────────────────────────
# Install
# ──────────────────────────────────────────────

install:
	cd gatekeeper-proxy && pip install -e ".[dev]"
	cd gatekeeper-backend && pip install -e ".[dev]"
	cd gatekeeper-control-plane && pip install -e ".[dev]"

# ──────────────────────────────────────────────
# mTLS Certificates
# ──────────────────────────────────────────────

certs:
	bash infra/generate-certs.sh

# ──────────────────────────────────────────────
# Testing
# ──────────────────────────────────────────────

test-proxy:
	cd gatekeeper-proxy && python -m pytest tests/ -v

test-backend:
	cd gatekeeper-backend && python -m pytest tests/ -v

test-control-plane:
	cd gatekeeper-control-plane && python -m pytest tests/ -v

test-all: test-proxy test-backend

smoke:
	bash infra/smoke-tests.sh

# ──────────────────────────────────────────────
# Linting
# ──────────────────────────────────────────────

lint-proxy:
	cd gatekeeper-proxy && ruff check .

lint-backend:
	cd gatekeeper-backend && ruff check .

lint-control-plane:
	cd gatekeeper-control-plane && ruff check .

lint: lint-proxy lint-backend lint-control-plane

# ──────────────────────────────────────────────
# Formatting
# ──────────────────────────────────────────────

fmt:
	ruff format gatekeeper-proxy/ gatekeeper-backend/ gatekeeper-control-plane/
	ruff check --fix gatekeeper-proxy/ gatekeeper-backend/ gatekeeper-control-plane/
