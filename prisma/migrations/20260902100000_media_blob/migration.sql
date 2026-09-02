-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "meta" JSONB;

-- CreateTable
CREATE TABLE "MediaBlob" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaBlob_mediaId_key" ON "MediaBlob"("mediaId");

-- AddForeignKey
ALTER TABLE "MediaBlob" ADD CONSTRAINT "MediaBlob_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
