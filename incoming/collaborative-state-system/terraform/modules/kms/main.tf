# KMS Module - broker JWT signing
#
# The auth broker MAC-signs P1 CCR tokens with a Cloud KMS HMAC key
# (workers/src/auth/broker/gcp-kms-client.ts). This provisions:
#   keyring  p1-auth-broker (global)
#   key      jwt-mac-signing (MAC / HMAC_SHA256 / SOFTWARE)
#   IAM      the p1-backend SA granted signerVerifier + viewer on the key
#
# The signer credential reaches the worker as the MAS_GCP_SERVICE_ACCOUNT_KEY
# secret: a JSON key generated with gcloud, never held in Terraform state.

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
  description = "Environment name (staging, sbx1, production)"
  type        = string
}

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "kms_location" {
  description = "Location for the broker key ring (a GCP region, or 'global')"
  type        = string
  default     = "global"
}

variable "key_ring_name" {
  description = "KMS key ring name"
  type        = string
  default     = "p1-auth-broker"
}

variable "crypto_key_name" {
  description = "MAC crypto key name the broker signs with"
  type        = string
  default     = "jwt-mac-signing"
}

variable "signer_sa_email" {
  description = "Email of the SA the broker authenticates as. Defaults to p1-backend@<project>."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  default_signer_email = "p1-backend@${var.gcp_project}.iam.gserviceaccount.com"

  signer_sa_email = var.signer_sa_email != "" ? var.signer_sa_email : local.default_signer_email
}

# -----------------------------------------------------------------------------
# Key ring + MAC key
# -----------------------------------------------------------------------------

resource "google_kms_key_ring" "broker" {
  project  = var.gcp_project
  name     = var.key_ring_name
  location = var.kms_location

  # Shared P1 ring carrying keys beyond this module.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "jwt_mac" {
  # HMAC_SHA256 MAC key for the broker's macSign / macVerify.
  name     = var.crypto_key_name
  key_ring = google_kms_key_ring.broker.id
  purpose  = "MAC"

  version_template {
    algorithm        = "HMAC_SHA256"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Signer key access
# -----------------------------------------------------------------------------

# viewer lets the broker resolve the key's primary version; signerVerifier
# covers macSign / macVerify.
resource "google_kms_crypto_key_iam_member" "signer" {
  crypto_key_id = google_kms_crypto_key.jwt_mac.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${local.signer_sa_email}"
}

resource "google_kms_crypto_key_iam_member" "viewer" {
  crypto_key_id = google_kms_crypto_key.jwt_mac.id
  role          = "roles/cloudkms.viewer"
  member        = "serviceAccount:${local.signer_sa_email}"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "kms_key_resource" {
  description = "Crypto key resource path for the worker's GCP_KMS_KEY_RESOURCE secret"
  value       = google_kms_crypto_key.jwt_mac.id
}

output "signer_sa_email" {
  description = "Signer SA email; create a JSON key for it and set it as MAS_GCP_SERVICE_ACCOUNT_KEY"
  value       = local.signer_sa_email
}
