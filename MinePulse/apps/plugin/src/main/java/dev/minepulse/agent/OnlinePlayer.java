package dev.minepulse.agent;

/**
 * A single online player, identified by UUID, plus the read-only attributes the
 * server already holds in memory. Nothing here is derived from private data
 * such as chat, IP addresses or account details.
 */
public record OnlinePlayer(
        String uuid,
        String username,
        String world,
        int pingMs,
        String gamemode,
        boolean operator,
        Position position,
        Double health,
        Integer foodLevel,
        Integer xpLevel,
        Integer mobKills,
        Integer deaths,
        Integer blocksMined,
        String clientBrand) {

    /** Block coordinates of a player. */
    public record Position(double x, double y, double z) {
    }
}
