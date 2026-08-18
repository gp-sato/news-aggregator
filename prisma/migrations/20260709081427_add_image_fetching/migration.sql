-- CreateEnum
CREATE TYPE "ImageFetchStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'NOT_FOUND', 'FAILED');

-- AlterTable
ALTER TABLE "NewsItem" ADD COLUMN     "imageFetchStatus" "ImageFetchStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "imageUrl" TEXT;
