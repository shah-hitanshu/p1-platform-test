# GitHub Actions Workload Identity Federation (WIF) Module
#
# Provisions keyless authentication for GitHub Actions to GCP:
# - Workload Identity Pool + OIDC Provider
# - Service Account with configurable IAM roles
# - WIF-to-SA impersonation binding scoped to the repository
#
# Bootstrap: The first `terraform apply` must be run locally since WIF
# does not yet exist for GitHub Actions to authenticate through.
#
#   1. gcloud auth application-default login
#   2. terraform init && terraform plan && terraform apply
#   3. Set outputs as GitHub environment variables:
#      - vars.GCP_WORKLOAD_IDENTITY_PROVIDER = output.workload_identity_provider
#      - vars.GCP_SERVICE_ACCOUNT            = output.service_account_email

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (cpub-staging, sbx1, production)"
  type        = string
}

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "github_org" {
  description = "GitHub organization name"
  type        = string
  default     = "pantheon-systems"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "collaborative-state-system"
}

variable "sa_roles" {
  description = "IAM roles to grant to the service account"
  type        = list(string)
  default = [
    "roles/cloudsql.admin",
  ]
}

variable "terraform_state_bucket" {
  description = "GCS bucket for Terraform state. If set, grants roles/storage.objectAdmin on this bucket."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# API Enablement
# -----------------------------------------------------------------------------

resource "google_project_service" "iamcredentials" {
  project = var.gcp_project
  service = "iamcredentials.googleapis.com"

  disable_on_destroy = false
}

# -----------------------------------------------------------------------------
# Workload Identity Pool & Provider
# -----------------------------------------------------------------------------

resource "google_iam_workload_identity_pool" "github_actions" {
  project                   = var.gcp_project
  workload_identity_pool_id = "css-github-actions"
  display_name              = "GitHub Actions (CSS)"
  description               = "Workload Identity Pool for GitHub Actions CI/CD"

  depends_on = [google_project_service.iamcredentials]
}

resource "google_iam_workload_identity_pool_provider" "github_actions" {
  project                            = var.gcp_project
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_actions.workload_identity_pool_id
  workload_identity_pool_provider_id = "css-github-oidc"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == '${var.github_org}/${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# -----------------------------------------------------------------------------
# Service Account
# -----------------------------------------------------------------------------

resource "google_service_account" "github_actions" {
  project      = var.gcp_project
  account_id   = "css-github-actions"
  display_name = "CSS GitHub Actions (${var.environment})"
  description  = "Service account for Terraform execution via GitHub Actions WIF"
}

# -----------------------------------------------------------------------------
# IAM Bindings
# -----------------------------------------------------------------------------

# Project-level roles for the service account
resource "google_project_iam_member" "sa_roles" {
  for_each = toset(var.sa_roles)

  project = var.gcp_project
  role    = each.value
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# GCS access for Terraform state bucket
resource "google_storage_bucket_iam_member" "state_bucket" {
  count = var.terraform_state_bucket != "" ? 1 : 0

  bucket = var.terraform_state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.github_actions.email}"
}

# Allow GitHub Actions to impersonate the service account via WIF
resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_actions.name}/attribute.repository/${var.github_org}/${var.github_repo}"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "workload_identity_provider" {
  description = "Full resource name of the WIF provider (set as vars.GCP_WORKLOAD_IDENTITY_PROVIDER in GitHub)"
  value       = google_iam_workload_identity_pool_provider.github_actions.name
}

output "service_account_email" {
  description = "Service account email (set as vars.GCP_SERVICE_ACCOUNT in GitHub)"
  value       = google_service_account.github_actions.email
}
