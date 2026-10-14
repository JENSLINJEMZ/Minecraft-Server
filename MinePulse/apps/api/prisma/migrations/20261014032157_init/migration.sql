-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "minecraftVersion" TEXT,
    "software" TEXT,
    "address" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentCredential_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentVersion" TEXT NOT NULL,
    "minecraftVersion" TEXT,
    "paperVersion" TEXT,
    "serverUptimeSeconds" INTEGER NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'online',
    CONSTRAINT "ServerHeartbeat_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetricSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tps1m" REAL,
    "tps5m" REAL,
    "tps15m" REAL,
    "mspt" REAL,
    "heapUsedBytes" BIGINT,
    "heapMaxBytes" BIGINT,
    "heapCommittedBytes" BIGINT,
    "cpuUsagePercent" REAL,
    CONSTRAINT "MetricSample_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetricAggregate1m" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "tps1mAvg" REAL,
    "tps5mAvg" REAL,
    "tps15mAvg" REAL,
    "msptAvg" REAL,
    "msptMax" REAL,
    "heapUsedAvg" REAL,
    "heapMaxAvg" REAL,
    "cpuAvg" REAL,
    "playerCountAvg" REAL,
    "playerCountMax" INTEGER,
    "sampleCount" INTEGER NOT NULL,
    CONSTRAINT "MetricAggregate1m_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetricAggregate1h" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "tps1mAvg" REAL,
    "tps5mAvg" REAL,
    "tps15mAvg" REAL,
    "msptAvg" REAL,
    "msptMax" REAL,
    "heapUsedAvg" REAL,
    "heapMaxAvg" REAL,
    "cpuAvg" REAL,
    "playerCountAvg" REAL,
    "playerCountMax" INTEGER,
    "sampleCount" INTEGER NOT NULL,
    CONSTRAINT "MetricAggregate1h_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Player" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "lastKnownUsername" TEXT NOT NULL,
    "firstSeenAt" DATETIME,
    "lastSeenAt" DATETIME
);

-- CreateTable
CREATE TABLE "PlayerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "playerUuid" TEXT NOT NULL,
    "usernameAtJoin" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL,
    "leftAt" DATETIME,
    "durationSeconds" INTEGER,
    "closedReason" TEXT,
    CONSTRAINT "PlayerSession_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerSession_playerUuid_fkey" FOREIGN KEY ("playerUuid") REFERENCES "Player" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PluginSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "collectedAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pluginCount" INTEGER NOT NULL,
    "inventoryHash" TEXT NOT NULL,
    CONSTRAINT "PluginSnapshot_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PluginRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "pluginName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "apiVersion" TEXT,
    CONSTRAINT "PluginRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PluginSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "detailsJson" TEXT,
    "requestId" TEXT,
    CONSTRAINT "ServerEvent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertRule" (
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
    "lastTriggeredAt" DATETIME,
    "lastDeliveryStatus" TEXT NOT NULL DEFAULT 'none',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlertRule_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertRuleId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "lastNotifiedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "triggerValue" REAL,
    "summary" TEXT,
    CONSTRAINT "AlertIncident_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "AlertRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertIncidentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" DATETIME,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_alertIncidentId_fkey" FOREIGN KEY ("alertIncidentId") REFERENCES "AlertIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerSettings" (
    "serverId" TEXT NOT NULL PRIMARY KEY,
    "retentionRawMetricsDays" INTEGER NOT NULL DEFAULT 7,
    "retentionAggregated1mDays" INTEGER NOT NULL DEFAULT 30,
    "retentionAggregated1hDays" INTEGER NOT NULL DEFAULT 180,
    "retentionEventsDays" INTEGER NOT NULL DEFAULT 30,
    "retentionPlayerSessionsDays" INTEGER NOT NULL DEFAULT 90,
    "heartbeatStaleSeconds" INTEGER NOT NULL DEFAULT 30,
    "heartbeatOfflineSeconds" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServerSettings_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AgentCredential_serverId_idx" ON "AgentCredential"("serverId");

-- CreateIndex
CREATE INDEX "AgentCredential_revokedAt_idx" ON "AgentCredential"("revokedAt");

-- CreateIndex
CREATE INDEX "ServerHeartbeat_serverId_receivedAt_idx" ON "ServerHeartbeat"("serverId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServerHeartbeat_serverId_sequence_key" ON "ServerHeartbeat"("serverId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ServerHeartbeat_serverId_requestId_key" ON "ServerHeartbeat"("serverId", "requestId");

-- CreateIndex
CREATE INDEX "MetricSample_serverId_recordedAt_idx" ON "MetricSample"("serverId", "recordedAt");

-- CreateIndex
CREATE INDEX "MetricSample_recordedAt_idx" ON "MetricSample"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSample_serverId_requestId_key" ON "MetricSample"("serverId", "requestId");

-- CreateIndex
CREATE INDEX "MetricAggregate1m_serverId_bucketStart_idx" ON "MetricAggregate1m"("serverId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricAggregate1m_serverId_bucketStart_key" ON "MetricAggregate1m"("serverId", "bucketStart");

-- CreateIndex
CREATE INDEX "MetricAggregate1h_serverId_bucketStart_idx" ON "MetricAggregate1h"("serverId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricAggregate1h_serverId_bucketStart_key" ON "MetricAggregate1h"("serverId", "bucketStart");

-- CreateIndex
CREATE INDEX "Player_lastSeenAt_idx" ON "Player"("lastSeenAt");

-- CreateIndex
CREATE INDEX "PlayerSession_serverId_joinedAt_idx" ON "PlayerSession"("serverId", "joinedAt");

-- CreateIndex
CREATE INDEX "PlayerSession_playerUuid_joinedAt_idx" ON "PlayerSession"("playerUuid", "joinedAt");

-- CreateIndex
CREATE INDEX "PlayerSession_leftAt_idx" ON "PlayerSession"("leftAt");

-- CreateIndex
CREATE INDEX "PluginSnapshot_serverId_collectedAt_idx" ON "PluginSnapshot"("serverId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PluginSnapshot_serverId_inventoryHash_key" ON "PluginSnapshot"("serverId", "inventoryHash");

-- CreateIndex
CREATE INDEX "PluginRecord_pluginName_idx" ON "PluginRecord"("pluginName");

-- CreateIndex
CREATE UNIQUE INDEX "PluginRecord_snapshotId_pluginName_key" ON "PluginRecord"("snapshotId", "pluginName");

-- CreateIndex
CREATE INDEX "ServerEvent_serverId_occurredAt_idx" ON "ServerEvent"("serverId", "occurredAt");

-- CreateIndex
CREATE INDEX "ServerEvent_severity_idx" ON "ServerEvent"("severity");

-- CreateIndex
CREATE INDEX "ServerEvent_eventType_idx" ON "ServerEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "ServerEvent_serverId_requestId_occurredAt_eventType_key" ON "ServerEvent"("serverId", "requestId", "occurredAt", "eventType");

-- CreateIndex
CREATE INDEX "AlertRule_serverId_idx" ON "AlertRule"("serverId");

-- CreateIndex
CREATE INDEX "AlertIncident_alertRuleId_status_idx" ON "AlertIncident"("alertRuleId", "status");

-- CreateIndex
CREATE INDEX "AlertIncident_status_idx" ON "AlertIncident"("status");

-- CreateIndex
CREATE INDEX "NotificationDelivery_alertIncidentId_idx" ON "NotificationDelivery"("alertIncidentId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
