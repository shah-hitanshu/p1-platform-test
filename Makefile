# Collaborative State System - Infrastructure Makefile
# Following Pantheon service template standards
# https://github.com/pantheon-systems/service-template

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Environment detection
ENV ?= local
TF_DIR := terraform/environments/$(ENV)

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
	@echo "$(BLUE)Collaborative State System - Tool Versions$(NC)"
	@echo "─────────────────────────────────────────────"
	@echo "Node:      $$(node --version 2>/dev/null || echo 'not installed')"
	@echo "pnpm:      $$(pnpm --version 2>/dev/null || echo 'not installed')"
	@echo "Terraform: $$(terraform version -json 2>/dev/null | jq -r '.terraform_version' || echo 'not installed')"
	@echo "Docker:    $$(docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',' || echo 'not installed')"
	@echo "Wrangler:  $$(cd workers && pnpm exec wrangler --version 2>/dev/null || echo 'not installed')"

##@ Local Development - Full Stack

.PHONY: dev
dev: ## Start all local services (Docker + Miniflare)
	@echo "$(GREEN)Starting local development environment...$(NC)"
	@$(MAKE) docker-up
	@echo ""
	@echo "$(GREEN)Services ready. Starting Miniflare...$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to stop the worker. Run 'make docker-down' to stop containers.$(NC)"
	@echo ""
	@$(MAKE) worker-dev

.PHONY: dev-docker-only
dev-docker-only: docker-up ## Start Docker services only (no Miniflare)
	@echo ""
	@echo "$(GREEN)Docker services running. Start worker separately with: make worker-dev$(NC)"

.PHONY: dev-stop
dev-stop: docker-down ## Stop all local services

.PHONY: dev-status
dev-status: ## Show status of local services
	@echo "$(BLUE)Docker Containers:$(NC)"
	@docker-compose -f docker/docker-compose.local.yaml ps 2>/dev/null || echo "  No containers running"
	@echo ""
	@echo "$(BLUE)Service Endpoints:$(NC)"
	@echo "  PostgreSQL:  localhost:5432"
	@echo "  Worker:      localhost:8787 (when running)"

##@ Docker Services

.PHONY: docker-up
docker-up: ## Start Docker containers (PostgreSQL, Firestore emulator)
	@echo "$(GREEN)Starting Docker containers...$(NC)"
	@docker-compose -f docker/docker-compose.local.yaml up -d
	@echo "$(GREEN)Waiting for services to be healthy...$(NC)"
	@./scripts/wait-for-services.sh

.PHONY: docker-down
docker-down: ## Stop Docker containers
	@echo "$(YELLOW)Stopping Docker containers...$(NC)"
	@docker-compose -f docker/docker-compose.local.yaml down

.PHONY: docker-restart
docker-restart: docker-down docker-up ## Restart Docker containers

.PHONY: docker-clean
docker-clean: ## Remove Docker containers and volumes (WARNING: destroys data)
	@echo "$(RED)WARNING: This will destroy all local data!$(NC)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@docker-compose -f docker/docker-compose.local.yaml down -v --remove-orphans

.PHONY: docker-logs
docker-logs: ## Show Docker container logs (follow mode)
	@docker-compose -f docker/docker-compose.local.yaml logs -f

.PHONY: docker-logs-postgres
docker-logs-postgres: ## Show PostgreSQL logs
	@docker-compose -f docker/docker-compose.local.yaml logs -f postgres

.PHONY: docker-logs-firestore
docker-logs-firestore: ## Show Firestore emulator logs
	@docker-compose -f docker/docker-compose.local.yaml logs -f firestore

##@ Worker Development (Miniflare)

.PHONY: worker-install
worker-install: ## Install worker dependencies
	@echo "$(GREEN)Installing worker dependencies...$(NC)"
	@cd workers && pnpm install

.PHONY: worker-dev
worker-dev: ## Start Cloudflare Worker in local mode (Miniflare)
	@if [ ! -f workers/.dev.vars ]; then \
		echo "$(YELLOW)No .dev.vars found. Generating...$(NC)"; \
		$(MAKE) worker-generate-secrets; \
	fi
	@echo "$(GREEN)Starting Miniflare local development server...$(NC)"
	@echo "$(BLUE)Hotkeys: L=toggle local/edge, X=exit$(NC)"
	@cd workers && pnpm dev

.PHONY: worker-generate-secrets
worker-generate-secrets: ## Generate mock secrets for .dev.vars
	@echo "$(GREEN)Generating local development secrets...$(NC)"
	@./scripts/generate-dev-vars.sh

.PHONY: worker-login
worker-login: ## Login to Cloudflare (for integration testing)
	@echo "$(YELLOW)Logging into Cloudflare...$(NC)"
	@echo "$(YELLOW)Note: Sessions expire after ~1 hour$(NC)"
	@cd workers && pnpm exec wrangler login

.PHONY: metrics-receiver
metrics-receiver: ## Start local metrics receiver with macOS notifications
	@echo "$(GREEN)Starting local metrics receiver...$(NC)"
	@echo "$(BLUE)This will send macOS notifications for issues$(NC)"
	@node scripts/local-metrics-receiver.js

##@ Terraform - Infrastructure Management

.PHONY: tf-init
tf-init: ## Initialize Terraform (ENV=local|sbx1)
	@echo "$(GREEN)Initializing Terraform for $(ENV)...$(NC)"
ifeq ($(ENV),local)
	@cd $(TF_DIR) && terraform init -backend=false
else
	@cd $(TF_DIR) && terraform init
endif

.PHONY: tf-plan
tf-plan: tf-init ## Plan Terraform changes
	@echo "$(GREEN)Planning Terraform for $(ENV)...$(NC)"
	@cd $(TF_DIR) && terraform plan -out=tfplan

.PHONY: tf-apply
tf-apply: ## Apply Terraform changes (requires tf-plan first)
	@if [ ! -f $(TF_DIR)/tfplan ]; then \
		echo "$(RED)Error: No tfplan found. Run 'make tf-plan' first.$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Applying Terraform for $(ENV)...$(NC)"
	@cd $(TF_DIR) && terraform apply tfplan
	@rm -f $(TF_DIR)/tfplan

.PHONY: tf-destroy
tf-destroy: ## Destroy Terraform resources (use with caution)
	@echo "$(RED)WARNING: This will destroy infrastructure for $(ENV)!$(NC)"
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

##@ Database Utilities

.PHONY: db-shell
db-shell: ## Open PostgreSQL interactive shell
	@docker-compose -f docker/docker-compose.local.yaml exec postgres psql -U cssuser cssdb

.PHONY: db-reset
db-reset: ## Reset database (drop and recreate all tables)
	@echo "$(RED)WARNING: This will destroy all database data!$(NC)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@docker-compose -f docker/docker-compose.local.yaml exec postgres psql -U cssuser cssdb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	@echo "$(GREEN)Database reset complete.$(NC)"

##@ Cleanup

.PHONY: clean
clean: ## Clean generated files (keeps Docker volumes)
	@echo "$(YELLOW)Cleaning generated files...$(NC)"
	@rm -rf workers/node_modules
	@rm -rf workers/dist
	@rm -rf terraform/environments/*/.terraform
	@rm -f terraform/environments/*/tfplan
	@rm -f terraform/environments/*/.terraform.lock.hcl
	@echo "$(GREEN)Clean complete.$(NC)"

.PHONY: clean-all
clean-all: docker-clean clean ## Clean everything including Docker volumes
	@rm -f workers/.dev.vars
	@echo "$(GREEN)Full clean complete.$(NC)"

##@ CI/CD Targets

.PHONY: ci-lint
ci-lint: tf-fmt ## Run infrastructure linting
	@echo "$(GREEN)Checking Terraform formatting...$(NC)"
	@terraform fmt -check -recursive terraform/ || (echo "$(RED)Terraform files need formatting. Run 'make tf-fmt'$(NC)" && exit 1)
	@echo "$(GREEN)Lint passed.$(NC)"

.PHONY: ci-validate
ci-validate: ## Validate all Terraform configurations
	@echo "$(GREEN)Validating Terraform configurations...$(NC)"
	@for env in local sbx1; do \
		echo "  Validating $$env..."; \
		cd terraform/environments/$$env && terraform init -backend=false > /dev/null && terraform validate || exit 1; \
		cd ../../..; \
	done
	@echo "$(GREEN)All configurations valid.$(NC)"

##@ Frontend Development

.PHONY: frontend-install
frontend-install: ## Install frontend dependencies
	@echo "$(GREEN)Installing frontend dependencies...$(NC)"
	@cd frontend && pnpm install

.PHONY: frontend-dev
frontend-dev: ## Start frontend development server
	@echo "$(GREEN)Starting frontend development server...$(NC)"
	@echo "$(BLUE)Frontend will be available at http://localhost:5173$(NC)"
	@cd frontend && pnpm dev

.PHONY: frontend-build
frontend-build: ## Build frontend for production
	@echo "$(GREEN)Building frontend...$(NC)"
	@cd frontend && pnpm build

.PHONY: frontend-lint
frontend-lint: ## Lint frontend code
	@echo "$(GREEN)Linting frontend code...$(NC)"
	@cd frontend && pnpm lint

.PHONY: frontend-test
frontend-test: ## Run frontend E2E tests
	@echo "$(GREEN)Running frontend E2E tests...$(NC)"
	@cd frontend && pnpm test:e2e

##@ Full Stack Development

.PHONY: dev-full
dev-full: ## Start full stack (Docker + Worker + Frontend)
	@echo "$(GREEN)Starting full stack development environment...$(NC)"
	@$(MAKE) docker-up
	@echo ""
	@echo "$(GREEN)Starting backend worker and frontend...$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to stop all services.$(NC)"
	@cd workers && pnpm dev & WORKER_PID=$$!; \
	trap "kill $$WORKER_PID 2>/dev/null; cd workers && pnpm cleanup:dev; exit 0" INT TERM EXIT; \
	sleep 3; \
	echo ""; \
	echo "$(GREEN)Starting frontend...$(NC)"; \
	cd frontend && pnpm dev; \
	kill $$WORKER_PID 2>/dev/null; \
	cd workers && pnpm cleanup:dev

.PHONY: install-all
install-all: worker-install frontend-install ## Install all dependencies
	@echo "$(GREEN)All dependencies installed.$(NC)"
