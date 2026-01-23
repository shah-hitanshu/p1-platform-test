# Collaborative State System - Sandbox (sbx1) Environment
#
# This configuration deploys to the sandbox Cloudflare account
# and connects to sandbox GCP resources.
#
# Prerequisites:
#   - Cloudflare API token with Workers permissions
#   - GCP service account with CloudSQL and Firestore access
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
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
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

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID"
  type        = string
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
# TODO: Implement sandbox resources
# -----------------------------------------------------------------------------
# - CloudSQL PostgreSQL instance
# - Firestore database
# - Cloudflare KV namespaces
# - Cloudflare Worker script and routes
# - Secrets from Vault
# -----------------------------------------------------------------------------

output "environment" {
  value = local.environment
}

output "status" {
  value = "Sandbox environment configuration placeholder. Implement resources as needed."
}
