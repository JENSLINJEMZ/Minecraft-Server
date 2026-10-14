-- AlterTable
ALTER TABLE "Server" ADD COLUMN "liveBansJson" TEXT;

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "playerUuid" TEXT,
    "playerName" TEXT,
    "detail" TEXT,
    "payloadJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resultMessage" TEXT,
    "requestedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "ModerationAction_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "playerUuid" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerFlag_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "playerUuid" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerNote_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ModerationAction_serverId_status_createdAt_idx" ON "ModerationAction"("serverId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_serverId_playerUuid_createdAt_idx" ON "ModerationAction"("serverId", "playerUuid", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerFlag_serverId_playerUuid_key" ON "PlayerFlag"("serverId", "playerUuid");

-- CreateIndex
CREATE INDEX "PlayerFlag_serverId_muted_idx" ON "PlayerFlag"("serverId", "muted");

-- CreateIndex
CREATE INDEX "PlayerNote_serverId_playerUuid_createdAt_idx" ON "PlayerNote"("serverId", "playerUuid", "createdAt");
