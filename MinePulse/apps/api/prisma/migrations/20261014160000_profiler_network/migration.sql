-- AlterTable
ALTER TABLE "MetricSample" ADD COLUMN "tickJson" TEXT;
ALTER TABLE "MetricSample" ADD COLUMN "pluginTickJson" TEXT;
ALTER TABLE "MetricSample" ADD COLUMN "netRxBytes" BIGINT;
ALTER TABLE "MetricSample" ADD COLUMN "netTxBytes" BIGINT;
