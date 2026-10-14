package dev.minepulse.agent;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Records join/leave events for the next flush. */
public final class PlayerListener implements Listener {

    private final EventBuffer buffer;

    public PlayerListener(EventBuffer buffer) {
        this.buffer = buffer;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onJoin(PlayerJoinEvent event) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("uuid", event.getPlayer().getUniqueId().toString());
        details.put("username", event.getPlayer().getName());
        buffer.add(Payloads.event(
                "player_joined",
                "info",
                Instant.now(),
                event.getPlayer().getName() + " joined the game",
                details));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("uuid", event.getPlayer().getUniqueId().toString());
        details.put("username", event.getPlayer().getName());
        buffer.add(Payloads.event(
                "player_left",
                "info",
                Instant.now(),
                event.getPlayer().getName() + " left the game",
                details));
    }
}
