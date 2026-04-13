# Cloudflare Module
#
# Creates Cloudflare infrastructure resources for the Collaborative State System:
# - KV Namespaces (config + session storage)
# - Queue (sync decoupling)
# - Hyperdrive (PostgreSQL connection pooling)
#
# Note: Worker deployment and Durable Object migrations are handled by wrangler,
# not Terraform. This matches Cloudflare's recommendations and avoids known
# provider issues with DO migrations.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (sbx1, production)"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "postgres_host" {
  description = "PostgreSQL host for Hyperdrive"
  type        = string
}

variable "postgres_port" {
  description = "PostgreSQL port for Hyperdrive"
  type        = number
  default     = 5432
}

variable "postgres_user" {
  description = "PostgreSQL username for Hyperdrive"
  type        = string
}

variable "postgres_password" {
  description = "PostgreSQL password for Hyperdrive"
  type        = string
  sensitive   = true
}

variable "postgres_database" {
  description = "PostgreSQL database name for Hyperdrive"
  type        = string
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  # Worker names follow Pantheon naming convention
  worker_name          = "collaborative-state-worker-${var.environment}"
  frontend_worker_name = "collaborative-state-frontend-${var.environment}"

  # Environment-specific configuration
  # CORS_ORIGINS is "*" because arbitrary frontend origins (Pantheon sites,
  # ephemeral dev envs) need access. JWT authentication is the security boundary.
  config = {
    sbx1 = {
      log_level    = "info"
      cors_origins = "*"
    }
    production = {
      log_level    = "warn"
      cors_origins = "*"
    }
  }

  current_config = lookup(local.config, var.environment, local.config["sbx1"])
}

# -----------------------------------------------------------------------------
# KV Namespaces
# -----------------------------------------------------------------------------

resource "cloudflare_workers_kv_namespace" "config_kv" {
  account_id = var.cloudflare_account_id
  title      = "css-config-kv-${var.environment}"
}

resource "cloudflare_workers_kv_namespace" "session_kv" {
  account_id = var.cloudflare_account_id
  title      = "css-session-kv-${var.environment}"
}

resource "cloudflare_workers_kv_namespace" "oauth_kv" {
  account_id = var.cloudflare_account_id
  title      = "css-auth-oauth-kv-${var.environment}"
}

# -----------------------------------------------------------------------------
# Queue (sync decoupling between DOs and PostgreSQL)
# -----------------------------------------------------------------------------

resource "cloudflare_queue" "sync_queue" {
  account_id = var.cloudflare_account_id
  queue_name = "css-sync-queue-${var.environment}"
}

# -----------------------------------------------------------------------------
# Hyperdrive (PostgreSQL connection pooling)
# -----------------------------------------------------------------------------

resource "cloudflare_hyperdrive_config" "postgres" {
  account_id = var.cloudflare_account_id
  name       = "css-postgres-${var.environment}"

  origin = {
    scheme   = "postgres"
    host     = var.postgres_host
    port     = var.postgres_port
    database = var.postgres_database
    user     = var.postgres_user
    password = var.postgres_password
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "config_kv_id" {
  description = "CONFIG_KV namespace ID"
  value       = cloudflare_workers_kv_namespace.config_kv.id
}

output "session_kv_id" {
  description = "SESSION_KV namespace ID"
  value       = cloudflare_workers_kv_namespace.session_kv.id
}

output "oauth_kv_id" {
  description = "OAUTH_KV namespace ID (CSS OAuth token storage)"
  value       = cloudflare_workers_kv_namespace.oauth_kv.id
}

output "queue_id" {
  description = "Sync queue ID"
  value       = cloudflare_queue.sync_queue.id
}

output "queue_name" {
  description = "Sync queue name"
  value       = cloudflare_queue.sync_queue.queue_name
}

output "hyperdrive_id" {
  description = "Hyperdrive config ID"
  value       = cloudflare_hyperdrive_config.postgres.id
}

output "worker_name" {
  description = "Cloudflare Worker name (API)"
  value       = local.worker_name
}

output "frontend_worker_name" {
  description = "Cloudflare Worker name (frontend)"
  value       = local.frontend_worker_name
}

# TODO: Custom domain for frontend Worker
# Uncomment and configure when a custom domain is available:
#
# resource "cloudflare_workers_custom_domain" "frontend" {
#   account_id = var.cloudflare_account_id
#   zone_id    = var.zone_id
#   hostname   = "css.${var.domain}"
#   service    = local.frontend_worker_name
# }

output "config" {
  description = "Environment configuration"
  value = {
    log_level    = local.current_config.log_level
    cors_origins = local.current_config.cors_origins
  }
}
