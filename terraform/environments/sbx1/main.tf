# Collaborative State System - Sandbox (sbx1) Environment
#
# This configuration deploys to the sandbox Cloudflare account
# and connects to sandbox GCP resources.
#
# Prerequisites:
#   - Cloudflare API token with Workers permissions
#   - GCP service account with CloudSQL access
#   - Vault access for secrets
#
# Usage:
#   make tf-init ENV=sbx1
#   make tf-plan ENV=sbx1
#   make tf-apply ENV=sbx1

terraform {
  required_version = ">= 1.6.0"

  # Remote backend - GCS bucket
  backend "gcs" {
    bucket = "pantheon-css-terraform-state"
    prefix = "sbx1"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables (populated via CI/CD or tfvars)
# -----------------------------------------------------------------------------

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudsql_authorized_networks" {
  description = "Authorized networks for CloudSQL access (Cloudflare egress IPs, VPN, etc.)"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

# -----------------------------------------------------------------------------
# Local Variables
# -----------------------------------------------------------------------------

locals {
  environment = "sbx1"
  project     = "collaborative-state-system"

  # Pantheon pan-* tagging convention
  default_tags = {
    "pan-service"     = "collaborative-state-system"
    "pan-team"        = "content-management"
    "pan-environment" = local.environment
    "pan-managed-by"  = "terraform"
  }
}

# -----------------------------------------------------------------------------
# Database Module (CloudSQL)
# -----------------------------------------------------------------------------

module "database" {
  source = "../../modules/database"

  environment = local.environment
  gcp_project = var.gcp_project
  gcp_region  = var.gcp_region

  cloudsql_tier                = "db-g1-small"
  cloudsql_disk_size           = 10
  cloudsql_availability_type   = "ZONAL"
  cloudsql_backup_enabled      = false
  cloudsql_authorized_networks = var.cloudsql_authorized_networks
  deletion_protection          = false
  cloudsql_max_connections     = 100 # 2.5x Hyperdrive total (30+10=40)

  tags = local.default_tags
}

# -----------------------------------------------------------------------------
# Cloudflare Module (KV, Queue, Hyperdrive)
# -----------------------------------------------------------------------------

module "cloudflare" {
  source = "../../modules/cloudflare"

  environment           = local.environment
  cloudflare_account_id = var.cloudflare_account_id

  postgres_host     = module.database.host
  postgres_port     = module.database.port
  postgres_user     = module.database.username
  postgres_password = module.database.password
  postgres_database = module.database.database
}

# -----------------------------------------------------------------------------
# MCP Server Module (OAuth KV)
# -----------------------------------------------------------------------------

module "cloudflare_mcp" {
  source = "../../modules/cloudflare-mcp"

  environment           = local.environment
  cloudflare_account_id = var.cloudflare_account_id
}


# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "environment" {
  description = "Current environment"
  value       = local.environment
}

# Database outputs
output "database_host" {
  description = "CloudSQL public IP"
  value       = module.database.public_ip
}

output "database_connection_string" {
  description = "PostgreSQL connection string"
  value       = module.database.connection_string
  sensitive   = true
}

# Cloudflare outputs (used by sync-terraform-to-wrangler.sh)
output "config_kv_id" {
  description = "CONFIG_KV namespace ID for wrangler.jsonc"
  value       = module.cloudflare.config_kv_id
}

output "session_kv_id" {
  description = "SESSION_KV namespace ID for wrangler.jsonc"
  value       = module.cloudflare.session_kv_id
}

output "queue_id" {
  description = "Sync queue ID"
  value       = module.cloudflare.queue_id
}

output "screenshot_queue_id" {
  description = "Screenshot queue ID"
  value       = module.cloudflare.screenshot_queue_id
}

output "screenshot_queue_name" {
  description = "Screenshot queue name"
  value       = module.cloudflare.screenshot_queue_name
}

output "screenshot_bucket_name" {
  description = "R2 bucket name for site screenshots"
  value       = module.cloudflare.screenshot_bucket_name
}

output "hyperdrive_id" {
  description = "Hyperdrive config ID for wrangler.jsonc"
  value       = module.cloudflare.hyperdrive_id
}

output "hyperdrive_nocache_id" {
  description = "Hyperdrive no-cache config ID for wrangler.jsonc (admin routes)"
  value       = module.cloudflare.hyperdrive_nocache_id
}

output "worker_name" {
  description = "Cloudflare Worker name (API)"
  value       = module.cloudflare.worker_name
}

output "frontend_worker_name" {
  description = "Cloudflare Worker name (frontend)"
  value       = module.cloudflare.frontend_worker_name
}

# MCP Server outputs
output "mcp_oauth_kv_id" {
  description = "MCP OAuth KV namespace ID for wrangler.jsonc"
  value       = module.cloudflare_mcp.mcp_oauth_kv_id
}

output "mcp_worker_name" {
  description = "MCP Worker name"
  value       = module.cloudflare_mcp.mcp_worker_name
}

# CSS OAuth KV output (OAUTH_KV for collaborative-state-worker — inlined auth server)
output "oauth_kv_id" {
  description = "OAUTH_KV namespace ID for workers/wrangler.jsonc"
  value       = module.cloudflare.oauth_kv_id
}
