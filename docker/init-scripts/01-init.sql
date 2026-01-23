-- PostgreSQL Initialization Script
-- Executed automatically on first container start
--
-- This creates the base schema for the collaborative state system.
-- Application migrations will extend this as needed.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create schemas for organization
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;

-- Grant usage to the application user
GRANT USAGE ON SCHEMA app TO cssuser;
GRANT USAGE ON SCHEMA audit TO cssuser;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app TO cssuser;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA audit TO cssuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app TO cssuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA audit TO cssuser;

-- Set default search path
ALTER DATABASE cssdb SET search_path TO app, public;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Database initialized successfully at %', NOW();
END $$;
