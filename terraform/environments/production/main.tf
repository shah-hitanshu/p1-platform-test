# Collaborative State System - Production Environment
#
# This configuration deploys production infrastructure:
# - CloudSQL PostgreSQL with HA and backups
# - Cloudflare KV namespaces, Queue, and Hyperdrive
#
# Prerequisites:
#   - Cloudflare API token with Workers permissions
#   - GCP service account with CloudSQL access
#   - Vault access for secrets
#
# Usage:
#   make tf-init ENV=production
#   make tf-plan ENV=production
#   make tf-apply ENV=production

terraform {
  required_version = ">= 1.6.0"

  # Remote backend - GCS bucket
  backend "gcs" {
    bucket = "p1-terraform-state-prod"
    prefix = "production"
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

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudsql_authorized_networks" {
  description = "Authorized networks for CloudSQL access (Cloudflare egress IPs, VPN, etc.)"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "kms_location" {
  description = "Location for the broker JWT KMS key ring (a GCP region, or 'global')"
  type        = string
  default     = "global"
}

# -----------------------------------------------------------------------------
# Local Variables
# -----------------------------------------------------------------------------

locals {
  environment = "production"
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
# Database Module (CloudSQL - Production)
# -----------------------------------------------------------------------------

module "database" {
  source = "../../modules/database"

  environment = local.environment
  gcp_project = var.gcp_project
  gcp_region  = var.gcp_region

  cloudsql_tier                = "db-custom-2-7680"
  cloudsql_disk_size           = 50
  cloudsql_availability_type   = "REGIONAL"
  cloudsql_backup_enabled      = true
  cloudsql_authorized_networks = var.cloudsql_authorized_networks
  deletion_protection          = true
  cloudsql_max_connections     = 200 # 2.5x Hyperdrive total (60+20=80)
  # 30s server-side query cap; see the flag comment in the module.
  cloudsql_statement_timeout_ms = 30000

  # TODO: move to an IAM group role and grant the group instead of
  # listing individuals here.
  iam_users = [
    "andrew.glago@pantheon.io",
    "nickheinbaugh@pantheon.io",
    "chris.yates@pantheon.io",
    "hitanshushah@pantheon.io",
    "anthonytran@pantheon.io",
  ]

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

  hyperdrive_origin_connection_limit         = 60 # Cached reads — primary traffic
  hyperdrive_nocache_origin_connection_limit = 20 # Admin writes — less frequent
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
# KMS Module (broker JWT signing)
# -----------------------------------------------------------------------------

module "kms" {
  source = "../../modules/kms"

  environment  = local.environment
  gcp_project  = var.gcp_project
  kms_location = var.kms_location
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

# KMS outputs (broker JWT signing)
output "kms_key_resource" {
  description = "Crypto key resource path for the GCP_KMS_KEY_RESOURCE secret"
  value       = module.kms.kms_key_resource
}

output "signer_sa_email" {
  description = "Broker signer SA email (p1-backend); create a JSON key for it and set it as MAS_GCP_SERVICE_ACCOUNT_KEY"
  value       = module.kms.signer_sa_email
}
