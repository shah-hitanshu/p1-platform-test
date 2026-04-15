# Bootstrap — GCP Project Setup
#
# One-time setup to prepare a GCP project for CI/CD. Currently provisions
# GitHub Actions Workload Identity Federation (WIF) for keyless auth.
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
      version = "~> 5.0"
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
# WIF Module
# -----------------------------------------------------------------------------

module "github_actions_wif" {
  source = "../modules/github-actions-wif"

  environment            = var.environment
  gcp_project            = var.gcp_project
  terraform_state_bucket = var.terraform_state_bucket
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "wif_provider" {
  description = "Set as vars.GCP_WORKLOAD_IDENTITY_PROVIDER in the GitHub environment"
  value       = module.github_actions_wif.workload_identity_provider
}

output "wif_service_account" {
  description = "Set as vars.GCP_SERVICE_ACCOUNT in the GitHub environment"
  value       = module.github_actions_wif.service_account_email
}
