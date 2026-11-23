-- Check-in face identification with two-person verification.

CREATE TYPE "IdentityMatchStatus" AS ENUM ('pending_verification', 'confirmed', 'disputed');
CREATE TYPE "IdentityMatchOutcome" AS ENUM ('admit', 'mismatch', 'no_match');
CREATE TYPE "IdentityVerificationDecision" AS ENUM ('confirm', 'reject');

CREATE TABLE "identity_matches" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "examId" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "matchedCandidateId" UUID,
  "probeKey" TEXT NOT NULL,
  "faceCount" INTEGER NOT NULL,
  "similarity" DOUBLE PRECISION,
  "threshold" DOUBLE PRECISION NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "proposedOutcome" "IdentityMatchOutcome" NOT NULL,
  "status" "IdentityMatchStatus" NOT NULL DEFAULT 'pending_verification',
  "settledAt" TIMESTAMP(3),
  "incidentId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "identity_matches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "identity_verifications" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "identityMatchId" UUID NOT NULL,
  "verifierId" UUID NOT NULL,
  "decision" "IdentityVerificationDecision" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "identity_verifiers" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "trainingModule" TEXT NOT NULL,
  "trainingCompletedAt" TIMESTAMP(3) NOT NULL,
  "authorizedById" UUID NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedById" UUID,
  CONSTRAINT "identity_verifiers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_matches_organizationId_status_idx" ON "identity_matches"("organizationId", "status");
CREATE INDEX "identity_matches_examId_candidateId_idx" ON "identity_matches"("examId", "candidateId");
CREATE UNIQUE INDEX "identity_verifications_identityMatchId_verifierId_key" ON "identity_verifications"("identityMatchId", "verifierId");
CREATE INDEX "identity_verifications_organizationId_idx" ON "identity_verifications"("organizationId");
CREATE UNIQUE INDEX "identity_verifiers_organizationId_userId_key" ON "identity_verifiers"("organizationId", "userId");

ALTER TABLE "identity_matches" ADD CONSTRAINT "identity_matches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_matches" ADD CONSTRAINT "identity_matches_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_matches" ADD CONSTRAINT "identity_matches_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_matches" ADD CONSTRAINT "identity_matches_matchedCandidateId_fkey" FOREIGN KEY ("matchedCandidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_identityMatchId_fkey" FOREIGN KEY ("identityMatchId") REFERENCES "identity_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_verifiers" ADD CONSTRAINT "identity_verifiers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_verifiers" ADD CONSTRAINT "identity_verifiers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_verifiers" ADD CONSTRAINT "identity_verifiers_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
