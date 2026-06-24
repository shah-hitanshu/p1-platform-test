# Bootstrap (staging): CI/CD service accounts for the staging GCP project.
#
# Provisions the GitHub Actions service accounts (admin apply SA + read-only
# plan SA) and their WIF impersonation bindings against Pantheon's central pool
# (pantheon-global-pool). The backend and target project are pinned in this file.
#
# Run manually with GCP credentials that have Owner/Editor on the project:

terraform {
  required_version = ">= 1.6.0"

  backend "gcs" {
    bucket = "cpub-staging-terraform-state"
    prefix = "bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

locals {
  environment            = "staging"
  gcp_project            = "pantheon-content-cloud-staging"
  terraform_state_bucket = "cpub-staging-terraform-state"
  manages_kms            = true

  # apply SA: manage the Cloud SQL instance, IAM-login for CI migrations, and
  # manage the broker KMS key.
  apply_sa_roles = concat(
    ["roles/cloudsql.admin", "roles/cloudsql.instanceUser"],
    local.manages_kms ? ["roles/cloudkms.admin"] : [],
  )

  # plan SA: project viewer for the read-only PR plan job.
  plan_sa_roles = ["roles/viewer"]
}

# Cloud KMS API for the broker signing key.
resource "google_project_service" "cloudkms" {
  count = local.manages_kms ? 1 : 0

  project = local.gcp_project
  service = "cloudkms.googleapis.com"

  disable_on_destroy = false
}

# Token minting for WIF impersonation of the CI service accounts.
resource "google_project_service" "iamcredentials" {
  project = local.gcp_project
  service = "iamcredentials.googleapis.com"

  disable_on_destroy = false
}

moved {
  from = module.github_actions_wif.google_project_service.iamcredentials
  to   = google_project_service.iamcredentials
}

# Apply SA: impersonated only by the main-gated deploy workflows.
module "github_actions_wif" {
  source = "../../modules/github-actions-wif"

  environment            = local.environment
  gcp_project            = local.gcp_project
  sa_roles               = local.apply_sa_roles
  terraform_state_bucket = local.terraform_state_bucket
  state_bucket_role      = "roles/storage.objectAdmin"
}

# Plan SA: impersonated by the PR plan job, which runs on any same-repo PR.
module "github_actions_plan" {
  source = "../../modules/github-actions-wif"

  environment            = local.environment
  gcp_project            = local.gcp_project
  account_id             = "css-github-actions-plan"
  sa_roles               = local.plan_sa_roles
  terraform_state_bucket = local.terraform_state_bucket
  state_bucket_role      = "roles/storage.objectViewer"
}

# CCR-owned secrets the deploy workflow reads and pushes as per-worker Wrangler
# secrets; values are added out of band.
module "secrets" {
  source = "../../modules/secrets"

  gcp_project = local.gcp_project
  secret_ids = [
    "CCR_MCP_AUTH0_CLIENT_SECRET",
    "CCR_MCP_STATE_SIGNING_SECRET",
    "CCR_BACKEND_AUTH0_CLIENT_SECRET",
  ]
  accessor_members = [
    "serviceAccount:${module.github_actions_wif.service_account_email}",
  ]
}

output "wif_service_account" {
  description = "Apply SA. Set as vars.GCP_SERVICE_ACCOUNT in the protected GitHub environment."
  value       = module.github_actions_wif.service_account_email
}

output "wif_plan_service_account" {
  description = "Plan SA email, used by the Terraform Plan workflow."
  value       = module.github_actions_plan.service_account_email
}

output "ccr_secret_ids" {
  description = "CCR-owned Secret Manager secret IDs."
  value       = module.secrets.secret_ids
}
