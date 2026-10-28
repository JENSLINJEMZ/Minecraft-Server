package dev.jemz.dupe;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * /dupe [count]: duplicates the item stack in the player's main hand. The
 * clone keeps the exact components of the original (enchantments, damage,
 * custom names) because ItemStack.clone() copies vanilla data components.
 * Permission dupe.use is operator-only by default; grant it to other groups
 * through LuckPerms if wanted. Overflow is dropped at the player's feet so
 * nothing can vanish.
 */
public final class QuickDupePlugin extends JavaPlugin {

    private static final int MAX_COUNT = 64;

    @Override
    public void onEnable() {
        getLogger().info("QuickDupe ready: /dupe [count]");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("dupe.use")) {
            sender.sendMessage("You don't have permission for /dupe.");
            return true;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can run /dupe.");
            return true;
        }
        int count = 1;
        if (args.length > 0) {
            try {
                count = Integer.parseInt(args[0]);
            } catch (NumberFormatException failure) {
                player.sendMessage("The count must be a whole number like /dupe 5");
                return true;
            }
            if (count < 1 || count > MAX_COUNT) {
                player.sendMessage("The count must be between 1 and " + MAX_COUNT);
                return true;
            }
        }
        ItemStack held = player.getInventory().getItemInMainHand();
        if (held.getType().isAir() || !held.getType().isItem()) {
            player.sendMessage("Hold the item you want to duplicate in your main hand.");
            return true;
        }
        ItemStack[] clones = new ItemStack[count];
        for (int i = 0; i < count; i++) {
            clones[i] = held.clone();
        }
        Map<Integer, ItemStack> leftover = player.getInventory().addItem(clones);
        int droppedOff = 0;
        StringBuilder names = new StringBuilder();
        for (ItemStack extra : leftover.values()) {
            player.getWorld().dropItemNaturally(player.getLocation(), extra);
            droppedOff += extra.getAmount();
        }
        String itemName = held.getType().name().toLowerCase(Locale.ROOT);
        String summary = "Duplicated " + itemName + " x" + count + " for " + player.getName()
                + (droppedOff > 0 ? " (" + droppedOff + " dropped - inventory full)" : "");
        player.sendMessage(summary);
        Bukkit.getConsoleSender().sendMessage("[QuickDupe] " + summary);
        getLogger().info(summary);
        return true;
    }
}
