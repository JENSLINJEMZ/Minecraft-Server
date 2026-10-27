package dev.minepulse.agent;

import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

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
     * Records the cause of death and, crucially, a Bukkit-serialized snapshot
     * of the exact loot that dropped. That snapshot is what powers the
     * dashboard's one-click "give loot back" restore (Bukkit's own NBT
     * serialization, so enchantments, durability and custom names survive).
     * The damage cause is a closed enum name, never free text, and the loot
     * payload never tops ~200 KB or the snapshot is marked unavailable instead
     * of silently truncating.
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
        details.put("kept_inventory", event.getKeepInventory());
        List<ItemStack> drops = event.getDrops();
        int droppedItems = 0;
        for (ItemStack drop : drops) {
            if (drop != null) {
                droppedItems += drop.getAmount();
            }
        }
        details.put("dropped_items", droppedItems);
        details.put("dropped_stacks", drops.size());
        if (!event.getKeepInventory() && !drops.isEmpty()) {
            try {
                String nbt = Base64.getEncoder()
                        .encodeToString(ItemStack.serializeItemsAsBytes(drops));
                if (nbt.length() <= 200_000) {
                    details.put("lost_items_nbt", nbt);
                } else {
                    details.put("snapshot_too_large", true);
                }
            } catch (RuntimeException failure) {
                // Live without the snapshot rather than killing the event; the
                // dashboard shows the death with no restorable items.
                details.put("snapshot_too_large", true);
            }
        }
        String summary = droppedItems > 0
                ? player.getName() + " died and dropped " + droppedItems + " items"
                : player.getName() + " died";
        buffer.add(Payloads.event("player_death", "info", Instant.now(), summary, details));
    }
}
