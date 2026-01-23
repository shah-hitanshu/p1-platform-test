# Workers Module
#
# Abstracts Cloudflare Worker configuration across environments:
# - local: Configuration for Miniflare (no actual CF resources)
# - sbx1/prod: Cloudflare Worker script and routes
#
# This module outputs configuration used to generate wrangler environment files.

terraform {
  required_version = ">= 1.6.0"
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (local, sbx1, production)"
  type        = string
}

variable "worker_port" {
  description = "Local worker port (Miniflare)"
  type        = number
  default     = 8787
}

variable "postgres_connection_string" {
  description = "PostgreSQL connection string"
  type        = string
  sensitive   = true
}

variable "firestore_project_id" {
  description = "Firestore project ID"
  type        = string
}

variable "firestore_host" {
  description = "Firestore host:port (emulator for local)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to apply to resources (pan-* convention)"
  type        = map(string)
  default     = {}
}

# Cloudflare-specific variables (used in non-local environments)
variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for worker routes"
  type        = string
  default     = ""
}

variable "worker_route_pattern" {
  description = "Cloudflare worker route pattern"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  is_local = var.environment == "local"
  
  # Worker name follows Pantheon naming convention
  worker_name = "collaborative-state-worker-${var.environment}"
  
  # Environment-specific configuration
  config = {
    local = {
      log_level    = "debug"
      cors_origins = "http://localhost:3000,http://localhost:8080,http://localhost:5173"
    }
    sbx1 = {
      log_level    = "info"
      cors_origins = "https://sbx1.pantheon.io"
    }
    production = {
      log_level    = "warn"
      cors_origins = "https://pantheon.io,https://app.pantheon.io"
    }
  }
  
  current_config = lookup(local.config, var.environment, local.config["local"])
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "worker_name" {
  description = "Cloudflare Worker name"
  value       = local.worker_name
}

output "worker_url" {
  description = "Worker URL"
  value       = local.is_local ? "http://localhost:${var.worker_port}" : "https://${local.worker_name}.workers.dev"
}

output "config" {
  description = "Worker configuration for this environment"
  value = {
    environment                = var.environment
    log_level                  = local.current_config.log_level
    cors_origins               = local.current_config.cors_origins
    postgres_connection_string = var.postgres_connection_string
    firestore_project_id       = var.firestore_project_id
    firestore_host             = var.firestore_host
  }
  sensitive = true
}

output "wrangler_env_name" {
  description = "Wrangler environment name for deployment"
  value       = var.environment == "local" ? null : var.environment
}
