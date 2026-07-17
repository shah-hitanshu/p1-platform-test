# P1 Media — staging environment

terraform {
  required_version = ">= 1.6.0"

  backend "gcs" {
    bucket = "cpub-staging-terraform-state"
    prefix = "p1-media"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.0"
    }
  }
}

provider "cloudflare" {
  # CLOUDFLARE_API_TOKEN env var required
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

module "cloudflare_media" {
  source = "../../modules/cloudflare-media"

  environment           = "staging"
  cloudflare_account_id = var.cloudflare_account_id
  custom_domain         = "" # Set to "staging.media.p1.pantheon.io" once DNS is provisioned
}

output "bucket_name" {
  value = module.cloudflare_media.bucket_name
}

output "bucket_public_url" {
  value = module.cloudflare_media.bucket_public_url
}

output "d1_database_id" {
  value = module.cloudflare_media.d1_database_id
}

output "d1_database_name" {
  value = module.cloudflare_media.d1_database_name
}
