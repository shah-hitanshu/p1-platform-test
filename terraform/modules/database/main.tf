# Database Module
#
# Abstracts database configuration across environments:
# - local: Docker PostgreSQL container (managed externally via docker-compose)
# - sbx1/prod: CloudSQL PostgreSQL (managed by this module)
#
# This module outputs connection information used by workers.

terraform {
  required_version = ">= 1.6.0"
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (local, sbx1, production)"
  type        = string
}

variable "postgres_host" {
  description = "PostgreSQL host"
  type        = string
}

variable "postgres_port" {
  description = "PostgreSQL port"
  type        = number
  default     = 5432
}

variable "postgres_user" {
  description = "PostgreSQL username"
  type        = string
}

variable "postgres_pass" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "postgres_db" {
  description = "PostgreSQL database name"
  type        = string
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

# -----------------------------------------------------------------------------
# Local Environment
# -----------------------------------------------------------------------------
# For local environment, database runs in Docker (managed by docker-compose)
# This module just outputs the connection string

locals {
  is_local = var.environment == "local"
  
  connection_string = "postgresql://${var.postgres_user}:${var.postgres_pass}@${var.postgres_host}:${var.postgres_port}/${var.postgres_db}"
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
  value       = var.postgres_host
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
