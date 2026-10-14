package dev.minepulse.agent;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Records join/leave/death events for the next flush. */
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

    /**
     * Records the cause of death so the dashboard can break down a player's
     * deaths. The damage cause is a closed enum name, never free text.
     */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("uuid", player.getUniqueId().toString());
        details.put("username", player.getName());
        if (player.getWorld() != null) {
            details.put("world", player.getWorld().getName());
        }
        EntityDamageEvent damage = player.getLastDamageCause();
        details.put("cause", damage == null ? "UNKNOWN" : damage.getCause().name());
        Player killer = player.getKiller();
        if (killer != null) {
            details.put("killer", killer.getName());
            details.put("killerUuid", killer.getUniqueId().toString());
        }
        buffer.add(Payloads.event(
                "player_death",
                "info",
                Instant.now(),
                player.getName() + " died",
                details));
    }
}
