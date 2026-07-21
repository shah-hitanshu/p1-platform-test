# CCR-owned Secret Manager containers.
#
# CCR shares the Content Publisher GCP project. Secret Manager ownership is
# per-secret-ID, so a disjoint set of CCR-namespaced IDs coexists with any
# secrets the other project's Terraform manages in the same project.
#
# Containers and access only: the secret material is added out of band

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0"
    }
  }
}

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "secret_ids" {
  description = "Secret Manager secret IDs to create"
  type        = list(string)
}

variable "accessor_members" {
  description = "IAM members granted secretAccessor on every secret (e.g. the deploy service account)"
  type        = list(string)
  default     = []
}

resource "google_secret_manager_secret" "this" {
  for_each = toset(var.secret_ids)

  project   = var.gcp_project
  secret_id = each.value

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = {
    for pair in setproduct(var.secret_ids, var.accessor_members) :
    "${pair[0]}::${pair[1]}" => { secret_id = pair[0], member = pair[1] }
  }

  project   = var.gcp_project
  secret_id = google_secret_manager_secret.this[each.value.secret_id].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}

output "secret_ids" {
  description = "Created secret IDs"
  value       = [for s in google_secret_manager_secret.this : s.secret_id]
}
