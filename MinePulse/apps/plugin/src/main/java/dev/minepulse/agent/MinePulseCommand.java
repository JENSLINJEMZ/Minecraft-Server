package dev.minepulse.agent;

import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/** {@code /minepulse <status|test|reload>} */
public final class MinePulseCommand implements CommandExecutor, TabCompleter {

    private static final List<String> SUBCOMMANDS = List.of("status", "test", "reload");

    private final MinePulseAgentPlugin plugin;

    public MinePulseCommand(MinePulseAgentPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(
            @NotNull CommandSender sender,
            @NotNull Command command,
            @NotNull String label,
            @NotNull String[] args) {

        if (!sender.hasPermission("minepulse.admin")) {
            sender.sendMessage(ChatColor.RED + "You do not have permission to manage the MinePulse agent.");
            return true;
        }

        String sub = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
        switch (sub) {
            case "status" -> plugin.sendStatus(sender);
            case "test" -> plugin.forceCycle(sender);
            case "reload" -> plugin.reloadAgentConfig(sender);
            default -> sender.sendMessage(
                    ChatColor.YELLOW + "Usage: /" + label + " <status|test|reload>");
        }
        return true;
    }

    @Override
    public @Nullable List<String> onTabComplete(
            @NotNull CommandSender sender,
            @NotNull Command command,
            @NotNull String alias,
            @NotNull String[] args) {
        if (args.length <= 1) {
            String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
            return SUBCOMMANDS.stream()
                    .filter(s -> s.startsWith(prefix))
                    .collect(Collectors.toList());
        }
        return List.of();
    }
}
