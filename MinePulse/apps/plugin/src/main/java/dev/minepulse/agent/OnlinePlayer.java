package dev.minepulse.agent;

/**
 * A single online player, identified by UUID, plus the read-only attributes the
 * server already holds in memory. Nothing here is derived from private data.
 */
public record OnlinePlayer(
        String uuid, String username, String world, int pingMs, String gamemode, boolean operator) {
}
