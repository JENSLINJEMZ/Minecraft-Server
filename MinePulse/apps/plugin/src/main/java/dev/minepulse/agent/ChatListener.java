package dev.minepulse.agent;

import io.papermc.paper.event.player.AsyncChatEvent;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;

/**
 * Records chat messages for the next flush, and cancels chat from players the
 * dashboard has muted. Muting runs first ({@code LOWEST}) so other plugins see
 * the cancellation; capture runs last ({@code MONITOR}) and only for messages
 * that were actually delivered. Both the legacy and the modern Paper chat
 * events are handled, and the capture path de-duplicates in case a server fires
 * both pipelines for the same message.
 */
public final class ChatListener implements Listener {

    private final ModerationExecutor executor;
    private final EventBuffer buffer;
    private final AgentConfig config;

    private String lastKey;
    private long lastKeyAtMs;
    private boolean lastRecorded;

    public ChatListener(ModerationExecutor executor, EventBuffer buffer, AgentConfig config) {
        this.executor = executor;
        this.buffer = buffer;
        this.config = config;
    }

    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void muteLegacyChat(AsyncPlayerChatEvent event) {
        if (executor.isMuted(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage(Component.text("You are muted by an operator."));
        }
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void muteModernChat(AsyncChatEvent event) {
        if (executor.isMuted(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage(Component.text("You are muted by an operator."));
        }
    }

    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onLegacyChat(AsyncPlayerChatEvent event) {
        record(event.getPlayer(), event.getMessage());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        String text = PlainTextComponentSerializer.plainText().serialize(event.message());
        record(event.getPlayer(), text);
    }

    /** Capture-time keyword match for the dashboard's "flagged" badge. */
    private boolean isFlagged(String message) {
        String lower = message.toLowerCase();
        for (String keyword : config.flagKeywords()) {
            if (!keyword.isBlank() && lower.contains(keyword.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    /** Capture one chat row if this handler is the first to see this message. */
    private void record(Player player, String original) {
        if (original == null) {
            return;
        }
        String trimmed = original.strip();
        if (trimmed.isEmpty()) {
            return;
        }
        String key = player.getUniqueId() + "|" + trimmed;
        long now = System.currentTimeMillis();
        synchronized (this) {
            if (lastRecorded && key.equals(lastKey) && (now - lastKeyAtMs) < 2000) {
                return; // The other chat pipeline already captured this message.
            }
            lastKey = key;
            lastKeyAtMs = now;
            lastRecorded = true;
        }
        Map<String, Object> details = new HashMap<>();
        details.put("uuid", player.getUniqueId().toString());
        details.put("username", player.getName());
        details.put("message", trimmed);
        details.put("messageId", UUID.randomUUID().toString());
        details.put("source", "chat");
        details.put("flagged", isFlagged(trimmed));
        buffer.add(Payloads.event(
                "chat_message",
                "info",
                Instant.now(),
                player.getName() + ": " + trimmed,
                details));
    }
}
