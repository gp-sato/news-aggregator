/*
  Warnings:

  - The values [PENDING] on the enum `ImageFetchStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;

-- 1. デフォルト値を削除し、カラムを一時的に TEXT に変換
ALTER TABLE "public"."NewsItem" ALTER COLUMN "imageFetchStatus" DROP DEFAULT;
ALTER TABLE "NewsItem" ALTER COLUMN "imageFetchStatus" TYPE TEXT;

-- 2. TEXT 状態で PENDING -> QUEUED に更新
UPDATE "NewsItem" SET "imageFetchStatus" = 'QUEUED' WHERE "imageFetchStatus" = 'PENDING';

-- 3. 新しい enum を作成し、TEXT カラムを新 enum に変換
CREATE TYPE "ImageFetchStatus_new" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCESS', 'NOT_FOUND', 'FAILED');
ALTER TABLE "NewsItem" ALTER COLUMN "imageFetchStatus" TYPE "ImageFetchStatus_new" USING ("imageFetchStatus"::"ImageFetchStatus_new");

-- 4. enum 名を入れ替えて旧 enum を削除
ALTER TYPE "ImageFetchStatus" RENAME TO "ImageFetchStatus_old";
ALTER TYPE "ImageFetchStatus_new" RENAME TO "ImageFetchStatus";
DROP TYPE "public"."ImageFetchStatus_old";

-- 5. デフォルト値を設定
ALTER TABLE "NewsItem" ALTER COLUMN "imageFetchStatus" SET DEFAULT 'QUEUED';

COMMIT;

-- AlterTable
ALTER TABLE "NewsItem" ALTER COLUMN "imageFetchStatus" SET DEFAULT 'QUEUED';
