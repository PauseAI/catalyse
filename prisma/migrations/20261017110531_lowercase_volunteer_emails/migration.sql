-- Accounts from before signup lowercased addresses can't sign in by password. Lowercase every
-- address that no other account holds in another case; those pairs are settled by merging.
UPDATE "volunteers" v
SET "email" = lower(btrim(v."email"))
WHERE v."email" <> lower(btrim(v."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "volunteers" o
    WHERE o."id" <> v."id" AND lower(btrim(o."email")) = lower(btrim(v."email"))
  );
