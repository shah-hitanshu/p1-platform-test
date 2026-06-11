# Bootstrap — GCP Project Setup
#
# One-time setup to prepare a GCP project for CI/CD. Provisions the GitHub
# Actions service account and its impersonation bindings against Pantheon's
# central WIF pool (pantheon-wif).
#
# Run locally with GCP credentials that have Owner/Editor access:
#
#   cd terraform/bootstrap
#   terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=bootstrap"
#   terraform apply -var="environment=staging" -var="gcp_project=<project-id>" -var="terraform_state_bucket=<state-bucket>"

terraform {
  required_version = ">= 1.6.0"

  backend "gcs" {
    # Configured via -backend-config per environment:
    #   bucket = "<env>-terraform-state"
    #   prefix = "bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (staging, sbx1, production)"
  type        = string
}

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "terraform_state_bucket" {
  description = "GCS bucket for Terraform state (grants the SA access)"
  type        = string
}

# -----------------------------------------------------------------------------
# CI service account roles
#
# All environments grant cloudsql.admin (manage the instance) and
# cloudsql.instanceUser (IAM login for CI database migrations). Environments
# that manage the broker KMS module (staging, production) additionally need
# cloudkms.admin to manage the key. The p1-backend signer SA exists
# out-of-band, so CI needs no service-account roles.
# -----------------------------------------------------------------------------

locals {
  manages_kms = contains(["staging", "production"], var.environment)

  ci_sa_roles = concat(
    ["roles/cloudsql.admin", "roles/cloudsql.instanceUser"],
    local.manages_kms ? ["roles/cloudkms.admin"] : [],
  )
}

# Cloud KMS API for the broker signing key.
resource "google_project_service" "cloudkms" {
  count = local.manages_kms ? 1 : 0

  project = var.gcp_project
  service = "cloudkms.googleapis.com"

  disable_on_destroy = false
}

# -----------------------------------------------------------------------------
# GitHub Actions GCP Access
# -----------------------------------------------------------------------------

module "github_actions_wif" {
  source = "../modules/github-actions-wif"

  environment            = var.environment
  gcp_project            = var.gcp_project
  terraform_state_bucket = var.terraform_state_bucket
  sa_roles               = local.ci_sa_roles
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "wif_service_account" {
  description = "Set as vars.GCP_SERVICE_ACCOUNT in the GitHub environment"
  value       = module.github_actions_wif.service_account_email
}
