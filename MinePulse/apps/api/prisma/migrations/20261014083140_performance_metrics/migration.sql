-- AlterTable
ALTER TABLE "MetricSample" ADD COLUMN "chunkCount" INTEGER;
ALTER TABLE "MetricSample" ADD COLUMN "daemonThreadCount" INTEGER;
ALTER TABLE "MetricSample" ADD COLUMN "directBufferBytes" BIGINT;
ALTER TABLE "MetricSample" ADD COLUMN "entityCount" INTEGER;
ALTER TABLE "MetricSample" ADD COLUMN "gcJson" TEXT;
ALTER TABLE "MetricSample" ADD COLUMN "heapOldBytes" BIGINT;
ALTER TABLE "MetricSample" ADD COLUMN "heapYoungBytes" BIGINT;
ALTER TABLE "MetricSample" ADD COLUMN "metaspaceUsedBytes" BIGINT;
ALTER TABLE "MetricSample" ADD COLUMN "nonHeapUsedBytes" BIGINT;
ALTER TABLE "MetricSample" ADD COLUMN "threadCount" INTEGER;

-- AlterTable
ALTER TABLE "Server" ADD COLUMN "systemJson" TEXT;
