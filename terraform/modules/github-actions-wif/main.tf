# GitHub Actions GCP Access Module
#
# Grants GitHub Actions keyless access to GCP through Pantheon's central
# Workload Identity Federation pool (pantheon-wif). Provisions:
# - A service account with configurable IAM roles
# - Impersonation bindings (workloadIdentityUser + serviceAccountTokenCreator)
#   for the owning repository and any additional authorized repositories
#
# Applied locally with owner/editor ADC:
#
#   1. gcloud auth application-default login
#   2. terraform init && terraform plan && terraform apply
#   3. Set the service account email as vars.GCP_SERVICE_ACCOUNT in GitHub.
#      The provider URL is supplied by the common-gh/auth-wif action.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0"
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

variable "account_id" {
  description = "Service account ID (the local part of the SA email)"
  type        = string
  default     = "css-github-actions"
}

variable "github_repo" {
  description = "GitHub repository that owns this CI identity"
  type        = string
  default     = "collaborative-state-system"
}

variable "additional_repos" {
  description = "Other repositories authorized to impersonate this service account: satellite services that deploy into the same project"
  type        = list(string)
  default     = ["p1-media-r2"]
}

variable "sa_roles" {
  description = "IAM roles to grant to the service account"
  type        = list(string)
  default = [
    "roles/cloudsql.admin",
    "roles/cloudsql.instanceUser",
  ]
}

variable "terraform_state_bucket" {
  description = "GCS bucket for Terraform state. If set, grants state_bucket_role on this bucket."
  type        = string
  default     = ""
}

variable "state_bucket_role" {
  description = "Role granted to the service account on the Terraform state bucket."
  type        = string
  default     = "roles/storage.objectAdmin"
}

variable "cloudflare_token_secret_id" {
  description = "Secret Manager secret holding the Cloudflare API token for Terraform CI"
  type        = string
  default     = "P1_CF_DEPLOY_TOKEN"
}

variable "additional_secret_ids" {
  description = "Extra Secret Manager secrets the SA can read, e.g. worker runtime credentials the deploy pushes to Cloudflare"
  type        = list(string)
  default     = []
}

variable "wif_pool_name" {
  description = "Resource path of Pantheon's shared Workload Identity pool (project pantheon-wif)"
  type        = string
  default     = "projects/374988255856/locations/global/workloadIdentityPools/pantheon-global-pool"
}

# -----------------------------------------------------------------------------
# Central Pantheon WIF principal
# -----------------------------------------------------------------------------

locals {
  # pantheon-global-pool maps attribute.repository to the bare repo name, so the
  # principal omits the pantheon-systems/ owner prefix.
  # Ref: pantheon-systems/pantheon-skills, skills/pantheon-wif.
  ci_principal = "principalSet://iam.googleapis.com/${var.wif_pool_name}/attribute.repository/${var.github_repo}"

  additional_principals = {
    for repo in var.additional_repos :
    repo => "principalSet://iam.googleapis.com/${var.wif_pool_name}/attribute.repository/${repo}"
  }
}

# -----------------------------------------------------------------------------
# Service Account
# -----------------------------------------------------------------------------

resource "google_service_account" "github_actions" {
  project      = var.gcp_project
  account_id   = var.account_id
  display_name = "CSS GitHub Actions ${var.environment} (${var.account_id})"
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
  role   = var.state_bucket_role
  member = "serviceAccount:${google_service_account.github_actions.email}"
}

# CI reads the Cloudflare API token from Secret Manager at apply time rather than from a stored
# GitHub secret. Scoped to this one secret; the binding is additive.
resource "google_secret_manager_secret_iam_member" "cloudflare_token" {
  project   = var.gcp_project
  secret_id = var.cloudflare_token_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_secret_manager_secret_iam_member" "additional_secrets" {
  for_each = toset(var.additional_secret_ids)

  project   = var.gcp_project
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.github_actions.email}"
}

# Allow the repository's WIF principal to impersonate and mint tokens for the SA
resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.ci_principal
}

resource "google_service_account_iam_member" "token_creator" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.ci_principal
}

resource "google_service_account_iam_member" "additional_workload_identity_user" {
  for_each = local.additional_principals

  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = each.value
}

resource "google_service_account_iam_member" "additional_token_creator" {
  for_each = local.additional_principals

  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "service_account_email" {
  description = "Service account email (set as vars.GCP_SERVICE_ACCOUNT in GitHub)"
  value       = google_service_account.github_actions.email
}
