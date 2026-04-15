# Collaborative State System - staging Environment
#
# This configuration deploys to the Content Publisher staging Cloudflare account
# and GCP project.

# Prerequisites:
#   - Cloudflare API token with Workers permissions
#   - GCP service account with CloudSQL access
#   - GCS bucket for Terraform state
#
# Usage:
#   make tf-init ENV=staging
#   make tf-plan ENV=staging
#   make tf-apply ENV=staging

terraform {
  required_version = ">= 1.6.0"

  # Remote backend - GCS bucket
  backend "gcs" {
    bucket = "cpub-staging-terraform-state"
    prefix = "css"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
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
# Variables (populated via tfvars or -var flags)
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
  environment = "staging"
  project     = "collaborative-state-system"

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

  cloudsql_tier                = "db-f1-micro"
  cloudsql_disk_size           = 10
  cloudsql_availability_type   = "ZONAL"
  cloudsql_backup_enabled      = false
  cloudsql_authorized_networks = var.cloudsql_authorized_networks
  deletion_protection          = false

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

output "hyperdrive_id" {
  description = "Hyperdrive config ID for wrangler.jsonc"
  value       = module.cloudflare.hyperdrive_id
}

output "worker_name" {
  description = "Cloudflare Worker name (API)"
  value       = module.cloudflare.worker_name
}
