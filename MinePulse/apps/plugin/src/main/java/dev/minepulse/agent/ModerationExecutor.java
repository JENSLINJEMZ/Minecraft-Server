package dev.minepulse.agent;

import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.BanList;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

/**
 * Executes whitelisted moderation actions on the server. Every verb maps to a
 * concrete Paper API call, so a compromised dashboard can never run arbitrary
 * commands. Must be invoked from the main thread.
 */
public final class ModerationExecutor {

    /** The agent refuses to change its own state, which would stop all reporting. */
    private static final String AGENT_PLUGIN = "MinePulseAgent";

    private final Set<UUID> muted = ConcurrentHashMap.newKeySet();

    /** Outcome reported back to the API for the audit trail. */
    public record Outcome(boolean ok, String message) {
        static Outcome ok(String message) {
            return new Outcome(true, message);
        }

        static Outcome fail(String message) {
            return new Outcome(false, message);
        }
    }

    /** Replace the set of muted players, keeping the agent in sync with the API. */
    public void setMuted(Collection<String> uuids) {
        Set<UUID> next = ConcurrentHashMap.newKeySet();
        for (String raw : uuids) {
            try {
                next.add(UUID.fromString(raw));
            } catch (IllegalArgumentException ignored) {
                // Skip malformed ids.
            }
        }
        muted.clear();
        muted.addAll(next);
    }

    public boolean isMuted(UUID uuid) {
        return muted.contains(uuid);
    }

    public Outcome execute(ModerationCommand command) {
        try {
            return switch (command.action() == null ? "" : command.action()) {
                case "kick" -> kick(command);
                case "ban" -> ban(command);
                case "unban" -> unban(command);
                case "op" -> setOp(command, true);
                case "deop" -> setOp(command, false);
                case "gamemode" -> gamemode(command);
                case "teleport" -> teleport(command);
                case "message" -> message(command);
                case "broadcast" -> broadcast(command);
                case "warn" -> warn(command);
                case "plugin_enable" -> pluginState(command, true);
                case "plugin_disable" -> pluginState(command, false);
                case "plugin_reload" -> pluginReload(command);
                default -> Outcome.fail("Unknown action '" + command.action() + "'");
            };
        } catch (Throwable failure) {
            return Outcome.fail(failure.getClass().getSimpleName() + ": " + failure.getMessage());
        }
    }

    private Outcome kick(ModerationCommand command) {
        Player player = online(command.targetUuid());
        if (player == null) {
            return Outcome.fail("Player is not online");
        }
        String reason = textOr(command.reason(), "Kicked by an operator");
        player.kick(Component.text(reason));
        return Outcome.ok("Kicked " + player.getName() + ": " + reason);
    }

    private Outcome ban(ModerationCommand command) {
        String target = targetName(command);
        if (target == null) {
            return Outcome.fail("No target name available for ban");
        }
        String reason = textOr(command.reason(), "Banned by an operator");
        BanList<?> bans = Bukkit.getBanList(BanList.Type.NAME);
        bans.addBan(target, reason, null, "MinePulse");
        Player player = online(command.targetUuid());
        if (player != null) {
            player.kick(Component.text(reason));
        }
        return Outcome.ok("Banned " + target + ": " + reason);
    }

    private Outcome unban(ModerationCommand command) {
        String target = targetName(command);
        if (target == null) {
            return Outcome.fail("No target name available for unban");
        }
        Bukkit.getBanList(BanList.Type.NAME).pardon(target);
        return Outcome.ok("Unbanned " + target);
    }

    @SuppressWarnings("deprecation")
    private Outcome setOp(ModerationCommand command, boolean op) {
        UUID uuid = uuid(command.targetUuid());
        if (uuid == null) {
            return Outcome.fail("No player UUID available");
        }
        OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        offline.setOp(op);
        String name = offline.getName() == null ? targetName(command) : offline.getName();
        return Outcome.ok((op ? "Granted operator to " : "Removed operator from ") + name);
    }

    private Outcome gamemode(ModerationCommand command) {
        Player player = online(command.targetUuid());
        if (player == null) {
            return Outcome.fail("Player is not online");
        }
        GameMode mode;
        try {
            mode = GameMode.valueOf(textOr(command.mode(), "").toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return Outcome.fail("Unknown gamemode '" + command.mode() + "'");
        }
        player.setGameMode(mode);
        return Outcome.ok("Set " + player.getName() + " gamemode to " + mode.name().toLowerCase(Locale.ROOT));
    }

    private Outcome teleport(ModerationCommand command) {
        Player player = online(command.targetUuid());
        if (player == null) {
            return Outcome.fail("Player is not online");
        }
        World world = Bukkit.getWorlds().isEmpty() ? player.getWorld() : Bukkit.getWorlds().get(0);
        Location spawn = world == null ? null : world.getSpawnLocation();
        if (spawn == null) {
            return Outcome.fail("Server has no spawn world");
        }
        player.teleport(spawn);
        return Outcome.ok("Teleported " + player.getName() + " to spawn");
    }

    private Outcome message(ModerationCommand command) {
        Player player = online(command.targetUuid());
        if (player == null) {
            return Outcome.fail("Player is not online");
        }
        String text = textOr(command.text(), "");
        player.sendMessage(Component.text("[Owner] " + text, NamedTextColor.BLUE));
        return Outcome.ok("Message delivered to " + player.getName());
    }

    private Outcome broadcast(ModerationCommand command) {
        String text = textOr(command.text(), "");
        Component line = Component.text("[Everyone] " + text, NamedTextColor.GREEN);
        int delivered = 0;
        for (Player player : Bukkit.getOnlinePlayers()) {
            player.sendMessage(line);
            delivered++;
        }
        Bukkit.getConsoleSender().sendMessage(line);
        return Outcome.ok("Broadcast to " + delivered + " player(s)");
    }

    private Outcome warn(ModerationCommand command) {
        Player player = online(command.targetUuid());
        String reason = textOr(command.reason(), "Please follow the server rules");
        if (player == null) {
            return Outcome.fail("Player is not online (warning recorded anyway)");
        }
        player.sendMessage(Component.text("[Warning] " + reason, NamedTextColor.YELLOW));
        return Outcome.ok("Warned " + player.getName() + ": " + reason);
    }

    /* --- plugin lifecycle ------------------------------------------------- */

    /**
     * Enable or disable an installed plugin at runtime. This is session-scoped:
     * Paper starts every jar it finds again on the next boot, so the change is
     * applied live but not persisted (the dashboard says as much).
     */
    private Outcome pluginState(ModerationCommand command, boolean enable) {
        Plugin target = pluginByName(command.plugin());
        if (target == null) {
            return Outcome.fail("Unknown plugin '" + command.plugin() + "'");
        }
        if (isAgent(target)) {
            return Outcome.fail("Refusing to change the MinePulse agent's own state");
        }
        PluginManager manager = Bukkit.getPluginManager();

        if (enable) {
            if (target.isEnabled()) {
                return Outcome.ok(target.getName() + " is already enabled");
            }
            manager.enablePlugin(target);
            return manager.isPluginEnabled(target.getName())
                    ? Outcome.ok("Enabled " + target.getName() + " until the next restart")
                    : Outcome.fail("Could not enable " + target.getName());
        }

        if (!target.isEnabled()) {
            return Outcome.ok(target.getName() + " is already disabled");
        }
        Set<String> before = enabledNames(manager);
        manager.disablePlugin(target);
        Set<String> after = enabledNames(manager);
        before.removeAll(after);
        before.remove(target.getName());
        if (!before.isEmpty()) {
            // Paper disables dependents along with the plugin; report them so the
            // dashboard is not surprised by the side effect.
            return Outcome.ok("Disabled " + target.getName() + " until the next restart (also disabled: "
                    + String.join(", ", before) + ")");
        }
        return Outcome.ok("Disabled " + target.getName() + " until the next restart");
    }

    /**
     * Paper has no per-plugin reload API, so a reload is a disable followed by
     * an enable (onDisable + onEnable again). Some plugins do not survive that,
     * so the outcome reports whether the plugin came back up.
     */
    private Outcome pluginReload(ModerationCommand command) {
        Plugin target = pluginByName(command.plugin());
        if (target == null) {
            return Outcome.fail("Unknown plugin '" + command.plugin() + "'");
        }
        if (isAgent(target)) {
            return Outcome.fail("Refusing to reload the MinePulse agent itself");
        }
        if (!target.isEnabled()) {
            return Outcome.fail(target.getName() + " is disabled - enable it instead of reloading");
        }
        PluginManager manager = Bukkit.getPluginManager();
        manager.disablePlugin(target);
        manager.enablePlugin(target);
        return manager.isPluginEnabled(target.getName())
                ? Outcome.ok("Reloaded " + target.getName() + " (disable then enable)")
                : Outcome.fail("Disabled " + target.getName() + " but it did not re-enable");
    }

    private static Plugin pluginByName(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        // Paper's plugin lookup is case-insensitive.
        return Bukkit.getPluginManager().getPlugin(name.trim());
    }

    private static boolean isAgent(Plugin plugin) {
        return AGENT_PLUGIN.equalsIgnoreCase(plugin.getName());
    }

    private static Set<String> enabledNames(PluginManager manager) {
        Set<String> names = new LinkedHashSet<>();
        for (Plugin plugin : manager.getPlugins()) {
            if (plugin.isEnabled()) {
                names.add(plugin.getName());
            }
        }
        return names;
    }

    private Player online(String rawUuid) {
        UUID uuid = uuid(rawUuid);
        return uuid == null ? null : Bukkit.getPlayer(uuid);
    }

    private static UUID uuid(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static String targetName(ModerationCommand command) {
        if (command.targetName() != null && !command.targetName().isBlank()) {
            return command.targetName();
        }
        UUID uuid = uuid(command.targetUuid());
        if (uuid == null) {
            return null;
        }
        Player player = Bukkit.getPlayer(uuid);
        if (player != null) {
            return player.getName();
        }
        OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        return offline.getName();
    }

    private static String textOr(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    /** Timestamp helper kept for future timed bans. */
    static Date now() {
        return new Date();
    }
}
