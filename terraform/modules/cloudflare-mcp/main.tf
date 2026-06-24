# MCP Server Cloudflare Module
#
# Creates Cloudflare infrastructure resources for the MCP Worker:
# - KV Namespace (OAuth token storage, used by @cloudflare/workers-oauth-provider)
#
# Worker deployment is handled by wrangler, not Terraform.
# This matches the pattern in terraform/modules/cloudflare/main.tf.

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
  description = "Environment name (sbx1, staging, production)"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

# -----------------------------------------------------------------------------
# KV Namespace for OAuth token storage
# -----------------------------------------------------------------------------

resource "cloudflare_workers_kv_namespace" "mcp_oauth_kv" {
  account_id = var.cloudflare_account_id
  title      = "css-mcp-oauth-kv-${var.environment}"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "mcp_oauth_kv_id" {
  description = "MCP OAuth KV namespace ID (for wrangler.jsonc)"
  value       = cloudflare_workers_kv_namespace.mcp_oauth_kv.id
}

output "mcp_worker_name" {
  description = "MCP Worker name"
  value       = "css-mcp-server-${var.environment}"
}
