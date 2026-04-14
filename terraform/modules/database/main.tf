# Database Module
#
# Abstracts database configuration across environments:
# - local: Docker PostgreSQL container (managed externally via docker-compose)
# - sbx1/prod: CloudSQL PostgreSQL (managed by this module)
#
# This module outputs connection information used by workers.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (local, sbx1, production)"
  type        = string
}

variable "postgres_host" {
  description = "PostgreSQL host (used for local environment)"
  type        = string
  default     = ""
}

variable "postgres_port" {
  description = "PostgreSQL port"
  type        = number
  default     = 5432
}

variable "postgres_user" {
  description = "PostgreSQL username"
  type        = string
  default     = "cssuser"
}

variable "postgres_pass" {
  description = "PostgreSQL password (used for local environment; generated for CloudSQL)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "postgres_db" {
  description = "PostgreSQL database name"
  type        = string
  default     = "cssdb"
}

variable "tags" {
  description = "Tags to apply to resources (pan-* convention)"
  type        = map(string)
  default     = {}
}

# CloudSQL-specific variables (used in non-local environments)
variable "cloudsql_tier" {
  description = "CloudSQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "cloudsql_disk_size" {
  description = "CloudSQL disk size in GB"
  type        = number
  default     = 10
}

variable "cloudsql_availability_type" {
  description = "CloudSQL availability type (ZONAL or REGIONAL)"
  type        = string
  default     = "ZONAL"
}

variable "cloudsql_backup_enabled" {
  description = "Enable automated backups for CloudSQL"
  type        = bool
  default     = false
}

variable "cloudsql_authorized_networks" {
  description = "Authorized networks for CloudSQL access"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "gcp_project" {
  description = "GCP project ID (required for CloudSQL)"
  type        = string
  default     = ""
}

variable "gcp_region" {
  description = "GCP region (required for CloudSQL)"
  type        = string
  default     = "us-central1"
}

variable "deletion_protection" {
  description = "Prevent accidental deletion of the CloudSQL instance"
  type        = bool
  default     = true
}

variable "cloudsql_max_connections" {
  description = "PostgreSQL max_connections database flag. Must be >= 2x the sum of all Hyperdrive origin_connection_limit values to absorb soft-limit overruns."
  type        = number
  default     = 100
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  is_local = var.environment == "local"

  # Cloudflare IP ranges used by Hyperdrive to connect to databases.
  # Source: https://www.cloudflare.com/ips-v4/
  # Last updated: 2026-03-06
  cloudflare_ipv4_cidrs = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]

  cloudflare_authorized_networks = [
    for cidr in local.cloudflare_ipv4_cidrs : {
      name  = "cloudflare-${replace(cidr, "/", "-")}"
      value = cidr
    }
  ]

  # Merge Cloudflare IPs with any additional authorized networks passed in
  all_authorized_networks = local.is_local ? [] : concat(
    local.cloudflare_authorized_networks,
    var.cloudsql_authorized_networks,
  )

  # For local: use provided host/pass; for CloudSQL: use instance IP and generated password
  effective_host = local.is_local ? var.postgres_host : (
    length(google_sql_database_instance.main) > 0 ? google_sql_database_instance.main[0].public_ip_address : ""
  )
  effective_pass = local.is_local ? var.postgres_pass : (
    length(random_password.db_password) > 0 ? random_password.db_password[0].result : ""
  )

  connection_string = "postgresql://${var.postgres_user}:${local.effective_pass}@${local.effective_host}:${var.postgres_port}/${var.postgres_db}"
}

# -----------------------------------------------------------------------------
# CloudSQL Resources (non-local environments only)
# -----------------------------------------------------------------------------

resource "random_password" "db_password" {
  count   = local.is_local ? 0 : 1
  length  = 32
  special = false
}

resource "google_sql_database_instance" "main" {
  count    = local.is_local ? 0 : 1
  provider = google

  name                = "css-postgres-${var.environment}"
  project             = var.gcp_project
  region              = var.gcp_region
  database_version    = "POSTGRES_15"
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.cloudsql_tier
    disk_size         = var.cloudsql_disk_size
    availability_type = var.cloudsql_availability_type
    disk_autoresize   = true

    database_flags {
      # Explicit max_connections prevents cascade connection exhaustion.
      # Rule: this value must be >= 2x the sum of all Hyperdrive origin_connection_limit
      # values, leaving headroom for soft-limit overruns, Cloud SQL Proxy sessions,
      # monitoring, and autovacuum. See 2026-04-13 sbx1 outage for context.
      name  = "max_connections"
      value = tostring(var.cloudsql_max_connections)
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"

      dynamic "authorized_networks" {
        for_each = local.all_authorized_networks
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.value
        }
      }
    }

    backup_configuration {
      enabled                        = var.cloudsql_backup_enabled
      point_in_time_recovery_enabled = var.cloudsql_backup_enabled
    }

    user_labels = var.tags
  }
}

resource "google_sql_database" "main" {
  count    = local.is_local ? 0 : 1
  provider = google

  name     = var.postgres_db
  project  = var.gcp_project
  instance = google_sql_database_instance.main[0].name
}

resource "google_sql_user" "main" {
  count    = local.is_local ? 0 : 1
  provider = google

  name     = var.postgres_user
  project  = var.gcp_project
  instance = google_sql_database_instance.main[0].name
  password = random_password.db_password[0].result
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "connection_string" {
  description = "PostgreSQL connection string"
  value       = local.connection_string
  sensitive   = true
}

output "host" {
  description = "PostgreSQL host"
  value       = local.effective_host
}

output "port" {
  description = "PostgreSQL port"
  value       = var.postgres_port
}

output "database" {
  description = "PostgreSQL database name"
  value       = var.postgres_db
}

output "username" {
  description = "PostgreSQL username"
  value       = var.postgres_user
}

output "password" {
  description = "PostgreSQL password"
  value       = local.effective_pass
  sensitive   = true
}

output "instance_name" {
  description = "CloudSQL instance name (empty for local)"
  value       = local.is_local ? "" : google_sql_database_instance.main[0].name
}

output "public_ip" {
  description = "CloudSQL public IP (empty for local)"
  value       = local.is_local ? "" : google_sql_database_instance.main[0].public_ip_address
}
