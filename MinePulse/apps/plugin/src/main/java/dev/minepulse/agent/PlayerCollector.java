package dev.minepulse.agent;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Snapshots the currently online players. Main thread only. */
public final class PlayerCollector {

    public List<OnlinePlayer> online() {
        List<OnlinePlayer> players = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            players.add(new OnlinePlayer(player.getUniqueId().toString(), player.getName()));
        }
        return players;
    }
}
