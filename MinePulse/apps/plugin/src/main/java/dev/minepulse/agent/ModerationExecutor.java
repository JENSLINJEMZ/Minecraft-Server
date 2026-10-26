package dev.minepulse.agent;

import java.io.IOException;
import java.util.Collection;
import java.util.Date;
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

/**
 * Executes whitelisted moderation actions on the server. Every verb maps to a
 * concrete Paper API call, so a compromised dashboard can never run arbitrary
 * commands. Must be invoked from the main thread.
 */
public final class ModerationExecutor {

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
     * Enable or disable an installed plugin by moving its jar between
     * {@code plugins/} and {@code plugins-disabled/}. Paper applies the change on
     * the next start; the plugin keeps running (or stays absent) until then.
     *
     * Doing this live is not an option: disabling a loaded plugin closes its
     * class loader, and re-enabling reuses that closed loader, which breaks class
     * lookups for every plugin in the loader group (observed breaking logins).
     */
    private Outcome pluginState(ModerationCommand command, boolean enable) {
        String requested = command.plugin();
        if (requested == null || requested.isBlank()) {
            return Outcome.fail("A plugin name is required");
        }
        PluginFiles files = new PluginFiles(Bukkit.getPluginsFolder().toPath());
        try {
            if (enable) {
                PluginFiles.JarInfo staged = files.findDisabled(requested).orElse(null);
                if (staged != null) {
                    if (PluginFiles.isAgentJar(staged)) {
                        return Outcome.fail("Refusing to change the MinePulse agent's own state");
                    }
                    files.stageEnable(staged);
                    StagedJars.clearPendingDisable(requested);
                    return Outcome.ok("Enabled " + staged.name() + " - applies on the next server start");
                }
                if (StagedJars.hasPendingDisable(requested)) {
                    StagedJars.clearPendingDisable(requested);
                    return Outcome.ok("Kept " + requested + " enabled - the staged disable was cancelled");
                }
                return files.findEnabled(requested).isPresent()
                        ? Outcome.ok(requested + " is already enabled")
                        : Outcome.fail("Unknown plugin '" + requested + "'");
            }

            PluginFiles.JarInfo live = files.findEnabled(requested).orElse(null);
            if (live == null) {
                return files.findDisabled(requested).isPresent()
                        ? Outcome.ok(requested + " is already disabled")
                        : Outcome.fail("Unknown plugin '" + requested + "'");
            }
            if (PluginFiles.isAgentJar(live)) {
                return Outcome.fail("Refusing to change the MinePulse agent's own state");
            }
            if (StagedJars.hasPendingDisable(requested)) {
                return Outcome.ok(requested + " is already staged to disable");
            }
            try {
                files.stageDisable(live);
                return Outcome.ok("Disabled " + live.name()
                        + " - applies on the next server start (still running now)");
            } catch (IOException locked) {
                // Windows keeps a loaded plugin's jar open, so the move has to
                // wait for shutdown. Anything else (permissions, missing folder)
                // is a real failure and must be reported as one.
                if (Bukkit.getPluginManager().getPlugin(live.name()) == null) {
                    return Outcome.fail("Could not move " + live.name() + "'s jar: " + locked.getMessage());
                }
                StagedJars.addPendingDisable(live.name(), live.path().getFileName().toString());
                return Outcome.ok("Disabled " + live.name()
                        + " - the jar moves out when the server stops next");
            }
        } catch (IOException failure) {
            return Outcome.fail("Could not move " + requested + "'s jar: " + failure.getMessage());
        }
    }

    /**
     * Paper has no safe runtime reload: a disable/enable cycle leaves the plugin
     * with a closed class loader. Changes are staged instead, so this verb is
     * rejected rather than pretending to work.
     */
    private Outcome pluginReload(ModerationCommand command) {
        return Outcome.fail("Reload is not supported - plugin changes apply on the next server start");
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
