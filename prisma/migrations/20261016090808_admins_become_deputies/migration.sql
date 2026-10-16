-- Admin powers are now held per chapter. Every admin becomes a deputy of their own chapter, and
-- the admin flag is cleared: it is set again, from ADMIN_EMAILS, for the global admins when they
-- next sign in. An admin with no chapter keeps no role; a global admin places them.
INSERT INTO "chapter_deputies" ("national_chapter_id", "volunteer_id")
  SELECT "national_chapter_id", "id" FROM "volunteers"
  WHERE "is_admin" AND "deleted_at" IS NULL AND "national_chapter_id" IS NOT NULL;

INSERT INTO "chapter_audit_events" ("action", "national_chapter_id", "target_volunteer_id", "details")
  SELECT 'DEPUTY_APPOINTED', "national_chapter_id", "volunteer_id", '{"source": "migration"}'::jsonb
  FROM "chapter_deputies";

UPDATE "volunteers" SET "is_admin" = false WHERE "is_admin";

UPDATE "admin_invites" SET "status" = 'revoked' WHERE "status" = 'pending';
