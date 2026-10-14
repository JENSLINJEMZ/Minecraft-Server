package dev.minepulse.agent;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Snapshots the currently online players. Main thread only. */
public final class PlayerCollector {

    public List<OnlinePlayer> online() {
        List<OnlinePlayer> players = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            players.add(new OnlinePlayer(
                    player.getUniqueId().toString(),
                    player.getName(),
                    worldName(player),
                    player.getPing(),
                    gamemode(player),
                    player.isOp()));
        }
        return players;
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
            return player.getGameMode() == null ? null : player.getGameMode().name().toLowerCase(Locale.ROOT);
        } catch (Throwable ignored) {
            return null;
        }
    }
}
