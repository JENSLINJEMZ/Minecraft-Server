-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "evaluationWindowSeconds" INTEGER NOT NULL DEFAULT 60,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 600,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyDiscord" BOOLEAN NOT NULL DEFAULT true,
    "mutedUntil" DATETIME,
    "lastTriggeredAt" DATETIME,
    "lastDeliveryStatus" TEXT NOT NULL DEFAULT 'none',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlertRule_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AlertRule" ("cooldownSeconds", "createdAt", "enabled", "evaluationWindowSeconds", "id", "lastDeliveryStatus", "lastTriggeredAt", "metric", "name", "operator", "serverId", "severity", "threshold", "updatedAt") SELECT "cooldownSeconds", "createdAt", "enabled", "evaluationWindowSeconds", "id", "lastDeliveryStatus", "lastTriggeredAt", "metric", "name", "operator", "serverId", "severity", "threshold", "updatedAt" FROM "AlertRule";
DROP TABLE "AlertRule";
ALTER TABLE "new_AlertRule" RENAME TO "AlertRule";
CREATE INDEX "AlertRule_serverId_idx" ON "AlertRule"("serverId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
