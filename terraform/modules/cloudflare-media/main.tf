# Cloudflare Media Module
#
# Creates Cloudflare R2 infrastructure for the P1 media service:
# - R2 bucket for image storage
# - Custom domain binding (once {env}.media.p1.pantheon.io is provisioned)
#
# Note: Worker deployment is handled by wrangler, not Terraform.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (sandbox, staging, production)"
  type        = string

  validation {
    condition     = contains(["sandbox", "staging", "production"], var.environment)
    error_message = "environment must be one of: sandbox, staging, production"
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "custom_domain" {
  description = "Custom domain for R2 public access (e.g. staging.media.p1.pantheon.io). Leave empty until DNS is provisioned."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  bucket_name = "p1-media-${var.environment == "production" ? "prod" : var.environment}"
}

# -----------------------------------------------------------------------------
# R2 Bucket
# -----------------------------------------------------------------------------

resource "cloudflare_r2_bucket" "media" {
  account_id = var.cloudflare_account_id
  name       = local.bucket_name
}

# -----------------------------------------------------------------------------
# Custom domain (uncomment once {env}.media.p1.pantheon.io is provisioned)
# -----------------------------------------------------------------------------

# resource "cloudflare_r2_bucket_custom_domain" "media" {
#   count      = var.custom_domain != "" ? 1 : 0
#   account_id = var.cloudflare_account_id
#   bucket_name = cloudflare_r2_bucket.media.name
#   domain     = var.custom_domain
#   enabled    = true
# }

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bucket_name" {
  description = "R2 bucket name (used as bucket_name in wrangler.jsonc)"
  value       = cloudflare_r2_bucket.media.name
}

output "bucket_public_url" {
  description = "Public URL for the R2 bucket (used as P1_MEDIA_URL in media-cdn nginx)"
  value       = var.custom_domain != "" ? "https://${var.custom_domain}" : "https://${cloudflare_r2_bucket.media.name}.${var.cloudflare_account_id}.r2.cloudflarestorage.com"
}
