-- Continuidad del estudio entre dispositivos (PC <-> móvil).
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "paso" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudySession_caseId_userId_deviceId_key" ON "StudySession"("caseId", "userId", "deviceId");
CREATE INDEX "StudySession_userId_lastSeenAt_idx" ON "StudySession"("userId", "lastSeenAt");
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
