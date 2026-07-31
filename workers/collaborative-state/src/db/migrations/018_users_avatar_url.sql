-- Migration 018: Add avatar_url column to users table
--
-- Stores the user's profile picture URL from their identity provider (e.g., Google).
-- This enables presence indicators to display user avatars.

ALTER TABLE app.users ADD COLUMN avatar_url TEXT;
