-- Migration 032: Implicit text-to-UUID cast
--
-- Promotes the built-in text→uuid cast from ASSIGNMENT to IMPLICIT.
-- This allows Hyperdrive connections (prepare: false) to compare
-- untyped text parameters against UUID columns without explicit
-- $1::uuid casts in every query.
--
-- Safe to apply: uses the same INOUT parsing that already handles
-- explicit casts like '...'::uuid. The only behavioural change is
-- that a non-UUID string passed to a UUID column now fails at
-- runtime ("invalid input syntax") instead of at planning time
-- ("operator does not exist: uuid = text"), which matches the
-- behaviour under prepared statements (prepare: true).

-- Drop the existing assignment-level cast so we can recreate it as implicit.
DROP CAST IF EXISTS (text AS uuid);
CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT;
