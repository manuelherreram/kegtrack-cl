BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "KegStatus" AS ENUM ('DIRTY', 'CLEAN', 'FULL', 'ON_TAP', 'AT_CLIENT', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "CouplerType" AS ENUM ('G', 'A', 'S', 'BALL_LOCK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "email" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "since" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "beerName" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "fillDate" DATE NOT NULL,
    "bestBeforeDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "comuna" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keg" (
    "id" TEXT NOT NULL,
    "kegCode" TEXT NOT NULL,
    "sizeLiters" INTEGER NOT NULL,
    "couplerType" "CouplerType" NOT NULL,
    "status" "KegStatus" NOT NULL DEFAULT 'DIRTY',
    "version" INTEGER NOT NULL DEFAULT 0,
    "remainingLiters" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tapLine" INTEGER,
    "deliveredAt" TIMESTAMPTZ(3),
    "guiaDespacho" TEXT,
    "depositClp" INTEGER,
    "notes" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentBatchId" TEXT,
    "currentClientId" TEXT,

    CONSTRAINT "Keg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keg_movements" (
    "id" TEXT NOT NULL,
    "kegId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kegVersion" INTEGER NOT NULL,
    "fromStatus" "KegStatus",
    "toStatus" "KegStatus" NOT NULL,
    "batchId" TEXT,
    "clientId" TEXT,
    "previousLiters" DOUBLE PRECISION,
    "remainingLiters" DOUBLE PRECISION NOT NULL,
    "tapLine" INTEGER,
    "deliveredAt" TIMESTAMPTZ(3),
    "guiaDespacho" TEXT,
    "depositClp" INTEGER,
    "notes" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keg_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_since_idx" ON "LoginAttempt"("since");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_batchCode_key" ON "Batch"("batchCode");

-- CreateIndex
CREATE UNIQUE INDEX "Client_rut_key" ON "Client"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "Keg_kegCode_key" ON "Keg"("kegCode");

-- CreateIndex
CREATE UNIQUE INDEX "Keg_tapLine_key" ON "Keg"("tapLine");

-- CreateIndex
CREATE INDEX "Keg_status_kegCode_idx" ON "Keg"("status", "kegCode");

-- CreateIndex
CREATE INDEX "Keg_currentClientId_idx" ON "Keg"("currentClientId");

-- CreateIndex
CREATE INDEX "Keg_currentBatchId_idx" ON "Keg"("currentBatchId");

-- CreateIndex
CREATE INDEX "keg_movements_clientId_occurredAt_idx" ON "keg_movements"("clientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "keg_movements_kegId_kegVersion_key" ON "keg_movements"("kegId", "kegVersion");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keg" ADD CONSTRAINT "Keg_currentBatchId_fkey" FOREIGN KEY ("currentBatchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keg" ADD CONSTRAINT "Keg_currentClientId_fkey" FOREIGN KEY ("currentClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keg_movements" ADD CONSTRAINT "keg_movements_kegId_fkey" FOREIGN KEY ("kegId") REFERENCES "Keg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keg_movements" ADD CONSTRAINT "keg_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keg_movements" ADD CONSTRAINT "keg_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keg_movements" ADD CONSTRAINT "keg_movements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Enforce physically coherent live records even if a write bypasses the UI.
ALTER TABLE "Keg"
  ADD CONSTRAINT "keg_capacity" CHECK ("sizeLiters" IN (19, 20, 30, 50)),
  ADD CONSTRAINT "keg_volume" CHECK (
    "remainingLiters" >= 0 AND "remainingLiters" <= "sizeLiters"
    AND ("status" <> 'FULL' OR "remainingLiters" = "sizeLiters")
    AND ("status" IN ('FULL', 'ON_TAP', 'AT_CLIENT') OR "remainingLiters" = 0)
  ),
  ADD CONSTRAINT "keg_batch" CHECK (
    ("status" IN ('FULL', 'ON_TAP', 'AT_CLIENT')) = ("currentBatchId" IS NOT NULL)
  ),
  ADD CONSTRAINT "keg_tap" CHECK (
    ("status" = 'ON_TAP') = ("tapLine" IS NOT NULL)
    AND ("tapLine" IS NULL OR "tapLine" BETWEEN 1 AND 999)
  ),
  ADD CONSTRAINT "keg_custody" CHECK (
    ("status" = 'AT_CLIENT' AND "currentClientId" IS NOT NULL AND "deliveredAt" IS NOT NULL)
    OR ("status" <> 'AT_CLIENT' AND "currentClientId" IS NULL AND "deliveredAt" IS NULL
        AND "guiaDespacho" IS NULL AND "depositClp" IS NULL)
  ),
  ADD CONSTRAINT "keg_deposit" CHECK ("depositClp" IS NULL OR "depositClp" >= 0),
  ADD CONSTRAINT "keg_version" CHECK ("version" >= 0);

ALTER TABLE "Batch" ADD CONSTRAINT "batch_date_order" CHECK ("bestBeforeDate" >= "fillDate");

CREATE FUNCTION public.reject_keg_movement_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'keg_movements is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER keg_movements_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.keg_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_keg_movement_change();

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kegtrack_app') THEN
    GRANT USAGE ON SCHEMA public TO kegtrack_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public."Keg", public."User", public."LoginAttempt" TO kegtrack_app;
    GRANT SELECT, INSERT ON TABLE public."Batch", public."Client", public.keg_movements TO kegtrack_app;
    GRANT SELECT, INSERT, DELETE ON TABLE public."Session" TO kegtrack_app;
    GRANT DELETE ON TABLE public."LoginAttempt" TO kegtrack_app;
  END IF;
END;
$$;

COMMIT;
