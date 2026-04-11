# Auth Server Cloudflare Module
#
# Creates Cloudflare infrastructure resources for the CSS Auth Server Worker:
# - KV Namespace (OAuth token storage, used by @cloudflare/workers-oauth-provider)
#
# Worker deployment is handled by wrangler, not Terraform.
# This matches the pattern in terraform/modules/cloudflare/main.tf and
# terraform/modules/cloudflare-mcp/main.tf.
#
# After applying, copy the output oauth_kv_id into:
#   workers/auth-server/wrangler.jsonc → env.sbx1.kv_namespaces[OAUTH_KV].id
#   workers/auth-server/wrangler.jsonc → env.production.kv_namespaces[OAUTH_KV].id

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
  description = "Environment name (sbx1, production)"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

# -----------------------------------------------------------------------------
# KV Namespace for OAuth token storage
# -----------------------------------------------------------------------------

resource "cloudflare_workers_kv_namespace" "auth_oauth_kv" {
  account_id = var.cloudflare_account_id
  title      = "css-auth-oauth-kv-${var.environment}"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "auth_oauth_kv_id" {
  description = "Auth Server OAuth KV namespace ID (for wrangler.jsonc)"
  value       = cloudflare_workers_kv_namespace.auth_oauth_kv.id
}

output "auth_server_worker_name" {
  description = "Auth Server Worker name"
  value       = "css-auth-server-${var.environment}"
}
