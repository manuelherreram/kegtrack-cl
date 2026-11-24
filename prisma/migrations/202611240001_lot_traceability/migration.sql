BEGIN;

CREATE TYPE "BatchStatus" AS ENUM ('HOLD', 'RELEASED');
CREATE TYPE "MovementKind" AS ENUM (
  'LEGACY', 'REGISTER', 'STATUS', 'FILL', 'TAP', 'DELIVER', 'RETURN_EMPTY',
  'RETURN_COLD', 'DISCARD', 'VOLUME', 'EDIT', 'CORRECTION'
);

CREATE TABLE "Beer" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "style" TEXT NOT NULL,
  "key" TEXT NOT NULL
);
CREATE UNIQUE INDEX "Beer_key_key" ON "Beer"("key");

ALTER TABLE "Batch"
  ADD COLUMN "beerId" TEXT,
  ADD COLUMN "status" "BatchStatus" NOT NULL DEFAULT 'HOLD',
  ADD COLUMN "packagedDeciliters" INTEGER,
  ADD COLUMN "allocatedDeciliters" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "controlVersion" INTEGER NOT NULL DEFAULT 0;

-- Existing lots retain their original product descriptions, dates and movement history.
WITH catalog AS (
  SELECT "id", "beerName", "style", "createdAt",
    jsonb_build_array(lower(btrim("beerName")), lower(btrim("style")))::text AS "key"
  FROM "Batch"
)
INSERT INTO "Beer" ("id", "name", "style", "key")
SELECT DISTINCT ON ("key") 'legacy-' || "id", "beerName", "style", "key"
FROM catalog ORDER BY "key", "createdAt", "id";

UPDATE "Batch" b SET "beerId" = p."id"
FROM "Beer" p
WHERE p."key" = jsonb_build_array(lower(btrim(b."beerName")), lower(btrim(b."style")))::text;

-- The old app always filled to nominal capacity. Opening inventory with a lot
-- was already packaged, even if its estimated remaining volume was lower.
UPDATE "Batch" b SET "allocatedDeciliters" = fills.total
FROM (
  SELECT m."batchId", SUM(
    CASE WHEN m."fromStatus" IS NULL THEN k."sizeLiters" * 10
         ELSE round(m."remainingLiters" * 10)::integer END
  ) AS total
  FROM "keg_movements" m JOIN "Keg" k ON k."id" = m."kegId"
  WHERE m."batchId" IS NOT NULL
    AND (m."fromStatus" IS NULL OR (m."fromStatus" = 'CLEAN' AND m."toStatus" = 'FULL'))
  GROUP BY m."batchId"
) fills WHERE fills."batchId" = b."id";

ALTER TABLE "Batch"
  ALTER COLUMN "beerId" SET NOT NULL,
  ADD CONSTRAINT "Batch_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "batch_stock" CHECK (
    "allocatedDeciliters" >= 0
    AND ("packagedDeciliters" IS NULL OR ("packagedDeciliters" > 0 AND "packagedDeciliters" >= "allocatedDeciliters"))
    AND ("status" <> 'RELEASED' OR "packagedDeciliters" IS NOT NULL)
    AND "controlVersion" >= 0
  );
CREATE INDEX "Batch_beerId_idx" ON "Batch"("beerId");

CREATE TABLE "BatchControl" (
  "id" TEXT PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "BatchStatus" NOT NULL,
  "packagedDeciliters" INTEGER,
  "notes" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BatchControl_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BatchControl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BatchControl_batchId_occurredAt_idx" ON "BatchControl"("batchId", "occurredAt");
CREATE TRIGGER batch_controls_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON "BatchControl"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_keg_movement_change();

ALTER TABLE "Keg" DROP CONSTRAINT "keg_volume";
ALTER TABLE "Keg" ADD CONSTRAINT "keg_volume" CHECK (
  "remainingLiters" >= 0 AND "remainingLiters" <= "sizeLiters"
  AND ("status" <> 'FULL' OR "remainingLiters" > 0)
  AND ("status" IN ('FULL', 'ON_TAP', 'AT_CLIENT') OR "remainingLiters" = 0)
);

ALTER TABLE "keg_movements"
  ADD COLUMN "kind" "MovementKind" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "previousState" JSONB,
  ADD COLUMN "discardedLiters" DOUBLE PRECISION,
  ADD COLUMN "correctsId" TEXT,
  ADD CONSTRAINT "keg_movements_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "keg_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "movement_correction" CHECK (("kind" = 'CORRECTION') = ("correctsId" IS NOT NULL)),
  ADD CONSTRAINT "movement_discard" CHECK (("kind" = 'DISCARD') = ("discardedLiters" IS NOT NULL) AND ("discardedLiters" IS NULL OR "discardedLiters" BETWEEN 0.1 AND 50));
CREATE UNIQUE INDEX "keg_movements_correctsId_key" ON "keg_movements"("correctsId");
CREATE INDEX "keg_movements_batchId_occurredAt_idx" ON "keg_movements"("batchId", "occurredAt");

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kegtrack_app') THEN
    GRANT SELECT, INSERT ON TABLE public."Beer", public."BatchControl" TO kegtrack_app;
    GRANT UPDATE ("status", "packagedDeciliters", "allocatedDeciliters", "controlVersion") ON TABLE public."Batch" TO kegtrack_app;
  END IF;
END;
$$;

COMMIT;
