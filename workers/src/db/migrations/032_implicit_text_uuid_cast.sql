-- Migration 032: Implicit text-to-UUID cast
--
-- Promotes the built-in text→uuid cast from ASSIGNMENT to IMPLICIT.
-- This allows Hyperdrive connections (prepare: false) to compare
-- untyped text parameters against UUID columns without explicit
-- $1::uuid casts in every query.

-- Drop the existing assignment-level cast so we can recreate it as implicit.
DROP CAST IF EXISTS (text AS uuid);
CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT;
