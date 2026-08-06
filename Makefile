# Collaborative State System - Infrastructure Makefile
# Following Pantheon service template standards
# https://github.com/pantheon-systems/service-template

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Environment detection
ENV ?= local
TF_DIR := terraform/environments/$(ENV)

# Container runtime detection: prefer whichever engine is actually running.
# Override with: make dev CONTAINER_ENGINE=docker
CONTAINER_ENGINE ?= $(shell docker info >/dev/null 2>&1 && echo docker || (podman info >/dev/null 2>&1 && echo podman) || echo docker)
COMPOSE_CMD ?= $(shell $(CONTAINER_ENGINE) compose version >/dev/null 2>&1 && echo "$(CONTAINER_ENGINE) compose" || echo "$(CONTAINER_ENGINE)-compose")

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m # No Color

##@ General

.PHONY: help
help: ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

.PHONY: version
version: ## Show version information for all tools
	@printf "$(BLUE)Collaborative State System - Tool Versions$(NC)\n"
	@printf "─────────────────────────────────────────────\n"
	@echo "Node:      $$(node --version 2>/dev/null || echo 'not installed')"
	@echo "pnpm:      $$(pnpm --version 2>/dev/null || echo 'not installed')"
	@echo "Terraform: $$(terraform version -json 2>/dev/null | jq -r '.terraform_version' || echo 'not installed')"
	@echo "Container: $$($(CONTAINER_ENGINE) --version 2>/dev/null || echo 'not installed')"
	@echo "Compose:   $$($(COMPOSE_CMD) version 2>/dev/null || echo 'not installed')"
	@echo "Wrangler:  $$(cd workers/collaborative-state && pnpm exec wrangler --version 2>/dev/null || echo 'not installed')"

##@ Local Development - Full Stack

.PHONY: dev
dev: ## Start all local services (containers + Miniflare)
	@printf "$(GREEN)Starting local development environment...$(NC)\n"
	@$(MAKE) docker-up
	@$(MAKE) db-ready
	@echo ""
	@printf "$(GREEN)Services ready. Starting Miniflare...$(NC)\n"
	@printf "$(YELLOW)Press Ctrl+C to stop the worker. Run 'make docker-down' to stop containers.$(NC)\n"
	@echo ""
	@$(MAKE) worker-dev

.PHONY: dev-docker-only
dev-docker-only: docker-up ## Start container services only (no Miniflare)
	@echo ""
	@printf "$(GREEN)Container services running. Start worker separately with: make worker-dev$(NC)\n"

.PHONY: dev-stop
dev-stop: docker-down ## Stop all local services

.PHONY: dev-status
dev-status: ## Show status of local services
	@printf "$(BLUE)Containers:$(NC)\n"
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml ps 2>/dev/null || echo "  No containers running"
	@printf "\n"
	@printf "$(BLUE)Service Endpoints:$(NC)\n"
	@echo "  PostgreSQL:  localhost:5432"
	@echo "  Worker:      localhost:8787 (when running)"

##@ Docker Services

.PHONY: docker-up
docker-up: ## Start containers (PostgreSQL)
	@printf "$(GREEN)Starting containers...$(NC)\n"
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml up -d
	@printf "$(GREEN)Waiting for services to be healthy...$(NC)\n"
	@CONTAINER_ENGINE=$(CONTAINER_ENGINE) ./scripts/css/wait-for-services.sh

.PHONY: db-ready
db-ready: ## Ensure .dev.vars exists and the local DB schema is migrated
	@[ -f workers/collaborative-state/.dev.vars ] || ./scripts/css/generate-dev-vars.sh
	@POSTGRES_CONNECTION_STRING=postgresql://cssuser:csspass@localhost:5432/cssdb pnpm --filter collaborative-state-worker db:migrate

.PHONY: docker-down
docker-down: ## Stop containers
	@printf "$(YELLOW)Stopping containers...$(NC)\n"
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml down

.PHONY: docker-restart
docker-restart: docker-down docker-up ## Restart containers

.PHONY: docker-clean
docker-clean: ## Remove containers and volumes (WARNING: destroys data)
	@printf "$(RED)WARNING: This will destroy all local data!$(NC)\n"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml down -v --remove-orphans

.PHONY: docker-logs
docker-logs: ## Show container logs (follow mode)
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml logs -f

.PHONY: docker-logs-postgres
docker-logs-postgres: ## Show PostgreSQL logs
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml logs -f postgres

##@ Worker Development (Miniflare)

.PHONY: worker-install
worker-install: ## Install worker dependencies
	@printf "$(GREEN)Installing worker dependencies...$(NC)\n"
	@cd workers/collaborative-state && pnpm install

.PHONY: worker-dev
worker-dev: ## Start Cloudflare Worker in local mode (Miniflare)
	@if [ ! -f workers/collaborative-state/.dev.vars ]; then \
		printf "$(YELLOW)No .dev.vars found. Generating...$(NC)\n"; \
		$(MAKE) worker-generate-secrets; \
	fi
	@printf "$(GREEN)Starting Miniflare local development server...$(NC)\n"
	@printf "$(BLUE)Hotkeys: L=toggle local/edge, X=exit$(NC)\n"
	@cd workers/collaborative-state && pnpm dev

.PHONY: worker-generate-secrets
worker-generate-secrets: ## Generate mock secrets for .dev.vars
	@printf "$(GREEN)Generating local development secrets...$(NC)\n"
	@./scripts/css/generate-dev-vars.sh

.PHONY: worker-login
worker-login: ## Login to Cloudflare (for integration testing)
	@printf "$(YELLOW)Logging into Cloudflare...$(NC)\n"
	@printf "$(YELLOW)Note: Sessions expire after ~1 hour$(NC)\n"
	@cd workers/collaborative-state && pnpm exec wrangler login

.PHONY: metrics-receiver
metrics-receiver: ## Start local metrics receiver with macOS notifications
	@printf "$(GREEN)Starting local metrics receiver...$(NC)\n"
	@printf "$(BLUE)This will send macOS notifications for issues$(NC)\n"
	@node scripts/css/local-metrics-receiver.mjs

##@ Terraform - Infrastructure Management

.PHONY: tf-init
tf-init: ## Initialize Terraform (ENV=local|staging|production)
	@printf "$(GREEN)Initializing Terraform for $(ENV)...$(NC)\n"
ifeq ($(ENV),local)
	@cd $(TF_DIR) && terraform init -backend=false
else
	@cd $(TF_DIR) && terraform init
endif

.PHONY: tf-plan
tf-plan: tf-init ## Plan Terraform changes
	@printf "$(GREEN)Planning Terraform for $(ENV)...$(NC)\n"
	@cd $(TF_DIR) && terraform plan -out=tfplan

.PHONY: tf-apply
tf-apply: ## Apply Terraform changes (requires tf-plan first)
	@if [ ! -f $(TF_DIR)/tfplan ]; then \
		printf "$(RED)Error: No tfplan found. Run 'make tf-plan' first.$(NC)\n"; \
		exit 1; \
	fi
	@printf "$(YELLOW)Applying Terraform for $(ENV)...$(NC)\n"
	@cd $(TF_DIR) && terraform apply tfplan
	@rm -f $(TF_DIR)/tfplan

.PHONY: tf-destroy
tf-destroy: ## Destroy Terraform resources (use with caution)
	@printf "$(RED)WARNING: This will destroy infrastructure for $(ENV)!$(NC)\n"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@cd $(TF_DIR) && terraform destroy

.PHONY: tf-fmt
tf-fmt: ## Format all Terraform files
	@terraform fmt -recursive terraform/

.PHONY: tf-validate
tf-validate: tf-init ## Validate Terraform configuration
	@cd $(TF_DIR) && terraform validate

.PHONY: tf-output
tf-output: ## Show Terraform outputs
	@cd $(TF_DIR) && terraform output

.PHONY: tf-sync
tf-sync: ## Sync Terraform outputs to wrangler.jsonc (ENV=staging|production)
	@printf "$(GREEN)Syncing Terraform outputs to wrangler.jsonc...$(NC)\n"
	@./scripts/css/sync-terraform-to-wrangler.sh $(ENV)

##@ Database Utilities

.PHONY: db-shell
db-shell: ## Open PostgreSQL interactive shell
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml exec postgres psql -U cssuser cssdb

.PHONY: db-reset
db-reset: ## Reset database (drop and recreate all tables)
	@printf "$(RED)WARNING: This will destroy all database data!$(NC)\n"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@$(COMPOSE_CMD) -f docker/docker-compose.local.yaml exec postgres psql -U cssuser cssdb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	@printf "$(GREEN)Database reset complete.$(NC)\n"

##@ Cleanup

.PHONY: clean
clean: ## Clean generated files (keeps Docker volumes)
	@printf "$(YELLOW)Cleaning generated files...$(NC)\n"
	@rm -rf workers/collaborative-state/node_modules
	@rm -rf workers/collaborative-state/dist
	@rm -rf terraform/environments/*/.terraform
	@rm -f terraform/environments/*/tfplan
	@rm -f terraform/environments/*/.terraform.lock.hcl
	@printf "$(GREEN)Clean complete.$(NC)\n"

.PHONY: clean-all
clean-all: docker-clean clean ## Clean everything including Docker volumes
	@rm -f workers/collaborative-state/.dev.vars
	@printf "$(GREEN)Full clean complete.$(NC)\n"

##@ CI/CD Targets

.PHONY: ci-lint
ci-lint: tf-fmt ## Run infrastructure linting
	@printf "$(GREEN)Checking Terraform formatting...$(NC)\n"
	@terraform fmt -check -recursive terraform/ || (printf "$(RED)Terraform files need formatting. Run 'make tf-fmt'$(NC)\n" && exit 1)
	@printf "$(GREEN)Lint passed.$(NC)\n"

.PHONY: ci-validate
ci-validate: ## Validate all Terraform configurations
	@printf "$(GREEN)Validating Terraform configurations...$(NC)\n"
	@for env in local staging production; do \
		echo "  Validating $$env..."; \
		cd terraform/environments/$$env && terraform init -backend=false > /dev/null && terraform validate || exit 1; \
		cd ../../..; \
	done
	@printf "$(GREEN)All configurations valid.$(NC)\n"

.PHONY: install-all
install-all: worker-install ## Install all dependencies
	@printf "$(GREEN)All dependencies installed.$(NC)\n"
