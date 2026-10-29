package dev.jemz.duelskit;

import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Small compatibility shim for Duels Optimised 8.3: that fork has no
 * "/duels kit" subcommand, but it ships a full kit GUI suite behind
 * `/kit custom`. This plugin catches `/duels kit` (and its /ds alias,
 * plus the common /duels kits typo) and bare `/kit` with no arguments
 * and forwards them to `/kit custom`, which opens the kit options GUI -
 * a native Bedrock form for Floodgate players, an inventory GUI for
 * Java clients. No command text is ever modified and the redirect is
 * limited to these exact inputs.
 */
public final class DuelsKitMenuPlugin extends JavaPlugin implements Listener {

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Ready: /duels kit now opens the kit options GUI");
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        String message = event.getMessage();
        if (message.length() > 256) {
            return;
        }
        String[] parts = message.split("\\s+");
        String root = parts[0].toLowerCase(Locale.ROOT);
        boolean duelsAdmin = root.equals("/duels") || root.equals("/ds");
        boolean bareKit = root.equals("/kit") && parts.length == 1;
        if (!duelsAdmin && !bareKit) {
            return;
        }
        if (duelsAdmin) {
            if (parts.length != 2) {
                return;
            }
            String sub = parts[1].toLowerCase(Locale.ROOT);
            if (sub.equals("kits")) {
                sub = "kit";
            }
            if (!sub.equals("kit")) {
                return;
            }
        }
        Player player = event.getPlayer();
        event.setCancelled(true);
        Bukkit.getScheduler().runTask(this, () -> {
            if (player.isOnline()) {
                Bukkit.dispatchCommand(player, "kit custom");
            }
        });
    }
}
