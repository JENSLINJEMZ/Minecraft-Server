package dev.minepulse.agent;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.bukkit.BanEntry;
import org.bukkit.BanList;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.Player;

/**
 * Snapshots the currently online players and the server ban list.
 * Must run on the main thread.
 */
public final class PlayerCollector {

    /** Block materials, cached once, used to total the "blocks mined" statistic. */
    private static final Material[] BLOCKS = blockMaterials();

    public List<OnlinePlayer> online() {
        List<OnlinePlayer> players = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            players.add(snapshot(player));
        }
        return players;
    }

    private static OnlinePlayer snapshot(Player player) {
        return new OnlinePlayer(
                player.getUniqueId().toString(),
                player.getName(),
                worldName(player),
                player.getPing(),
                gamemode(player),
                player.isOp(),
                position(player),
                health(player),
                foodLevel(player),
                xpLevel(player),
                statistic(player, Statistic.MOB_KILLS),
                statistic(player, Statistic.DEATHS),
                blocksMined(player),
                clientBrand(player));
    }

    /** The current name ban list, for real ban badges in the dashboard. */
    public List<BanRecord> bans() {
        List<BanRecord> out = new ArrayList<>();
        try {
            for (Object raw : Bukkit.getBanList(BanList.Type.NAME).getBanEntries()) {
                BanEntry<?> entry = (BanEntry<?>) raw;
                String target = entry.getTarget();
                if (target == null || target.isBlank()) {
                    continue;
                }
                out.add(new BanRecord(
                        target,
                        entry.getReason(),
                        entry.getSource(),
                        entry.getExpiration() == null ? null : entry.getExpiration().toInstant()));
            }
        } catch (Throwable ignored) {
            // The ban API differs slightly across builds; absent data degrades to none.
        }
        return out;
    }

    public record BanRecord(String target, String reason, String source, Instant expiresAt) {
    }

    private static String worldName(Player player) {
        try {
            return player.getWorld() == null ? null : player.getWorld().getName();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String gamemode(Player player) {
        try {
            GameMode mode = player.getGameMode();
            return mode == null ? null : mode.name().toLowerCase(Locale.ROOT);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static OnlinePlayer.Position position(Player player) {
        try {
            org.bukkit.Location loc = player.getLocation();
            return new OnlinePlayer.Position(
                    round(loc.getX()), round(loc.getY()), round(loc.getZ()));
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Double health(Player player) {
        try {
            return round(player.getHealth());
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Integer foodLevel(Player player) {
        try {
            return player.getFoodLevel();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Integer xpLevel(Player player) {
        try {
            return player.getLevel();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Integer statistic(Player player, Statistic statistic) {
        try {
            return player.getStatistic(statistic);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Integer blocksMined(Player player) {
        try {
            long total = 0L;
            for (Material material : BLOCKS) {
                total += player.getStatistic(Statistic.MINE_BLOCK, material);
            }
            return (int) Math.min(Integer.MAX_VALUE, total);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String clientBrand(Player player) {
        try {
            String brand = player.getClientBrandName();
            return brand == null || brand.isBlank() ? null : brand;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Material[] blockMaterials() {
        List<Material> list = new ArrayList<>();
        for (Material material : Material.values()) {
            try {
                if (material.isBlock()) {
                    list.add(material);
                }
            } catch (Throwable ignored) {
                // Legacy/air-ish values can throw on isBlock() in some builds.
            }
        }
        return list.toArray(new Material[0]);
    }

    private static double round(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
