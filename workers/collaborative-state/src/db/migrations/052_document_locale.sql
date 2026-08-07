-- Migration 052: Document Locale
--
-- Names the language a document's content is written in, as a BCP-47 tag (e.g.
-- 'fr-FR'). A source document may name the language it was authored in, so the tag
-- does not decide whether a document is a translation: that is carried by the
-- 'localization' edge in app.document_relations, which points a translation at the
-- canonical it derives from. NULL means the language is simply unrecorded.

ALTER TABLE app.documents
  ADD COLUMN locale TEXT;

COMMENT ON COLUMN app.documents.locale IS
  'BCP-47 language tag of this document''s content; NULL when unrecorded. A translation is identified by its localization edge, not by this column.';
