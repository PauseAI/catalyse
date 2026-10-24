-- CreateTable
CREATE TABLE "countries" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- The list lib/countries.ts held, with the entries it kept commented out disabled.
INSERT INTO "countries" ("code", "name", "enabled") VALUES
    ('Australia', 'Australia', true),
    ('Austria', 'Austria', false),
    ('Belgium', 'Belgium', true),
    ('Brazil', 'Brazil', false),
    ('Canada', 'Canada', true),
    ('Czech Republic', 'Czech Republic', true),
    ('Denmark', 'Denmark', false),
    ('Finland', 'Finland', false),
    ('France', 'France', true),
    ('Germany', 'Germany', true),
    ('Ghana', 'Ghana', true),
    ('India', 'India', false),
    ('Ireland', 'Ireland', false),
    ('Italy', 'Italy', true),
    ('Japan', 'Japan', false),
    ('Kenya', 'Kenya', true),
    ('Mexico', 'Mexico', false),
    ('Netherlands', 'Netherlands', true),
    ('New Zealand', 'New Zealand', false),
    ('Nigeria', 'Nigeria', true),
    ('Norway', 'Norway', false),
    ('Poland', 'Poland', true),
    ('Portugal', 'Portugal', false),
    ('Romania', 'Romania', true),
    ('Serbia', 'Serbia', true),
    ('Singapore', 'Singapore', false),
    ('South Korea', 'South Korea', false),
    ('Spain', 'Spain', true),
    ('Sweden', 'Sweden', true),
    ('Switzerland', 'Switzerland', true),
    ('UK', 'United Kingdom', true),
    ('US', 'United States', true);

-- Any chapter for a country not in that list keeps working, under the chapter's name.
INSERT INTO "countries" ("code", "name", "enabled")
SELECT "country", "name", true FROM "national_chapters"
ON CONFLICT ("code") DO NOTHING;

-- AddForeignKey
ALTER TABLE "national_chapters" ADD CONSTRAINT "national_chapters_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;
