# P1 Media — sandbox environment

terraform {
  required_version = ">= 1.6.0"

  backend "gcs" {
    bucket = "pantheon-css-terraform-state"
    prefix = "p1-media/sandbox"
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

  environment           = "sandbox"
  cloudflare_account_id = var.cloudflare_account_id
  custom_domain         = "" # Set to "sandbox.media.p1.pantheon.io" once DNS is provisioned
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
