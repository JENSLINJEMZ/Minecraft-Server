package dev.minepulse.agent;

import com.google.gson.Gson;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Builds the exact JSON wire payloads validated by the MinePulse API.
 * The field names and shapes mirror {@code packages/shared/src/schemas/telemetry.ts}.
 */
public final class Payloads {

    private static final int SCHEMA_VERSION = 1;
    private static final Gson GSON = new Gson();

    private Payloads() {
    }

    private static Map<String, Object> envelope(String serverId, long sequence) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("schemaVersion", SCHEMA_VERSION);
        body.put("serverId", serverId);
        body.put("requestId", UUID.randomUUID().toString());
        body.put("sequence", sequence);
        body.put("timestamp", Instant.now().toString());
        return body;
    }

    public static String heartbeat(
            String serverId,
            long sequence,
            String agentVersion,
            ServerIdentity identity,
            long uptimeSeconds,
            int maxPlayers,
            List<OnlinePlayer> online) {

        Map<String, Object> body = envelope(serverId, sequence);
        body.put("agentVersion", agentVersion);
        body.put("minecraftVersion", identity.minecraftVersion());
        body.put("paperVersion", identity.paperVersion());
        body.put("serverUptimeSeconds", uptimeSeconds);
        body.put("playerCount", online.size());
        body.put("maxPlayers", Math.max(1, maxPlayers));

        List<Map<String, Object>> players = new ArrayList<>(online.size());
        for (OnlinePlayer p : online) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("uuid", p.uuid());
            entry.put("username", p.username());
            players.add(entry);
        }
        body.put("players", players);
        return GSON.toJson(body);
    }

    public static String metrics(String serverId, long sequence, MetricReading r) {
        Map<String, Object> body = envelope(serverId, sequence);
        body.put("tps1m", r.tps1m());
        body.put("tps5m", r.tps5m());
        body.put("tps15m", r.tps15m());
        body.put("mspt", r.mspt());
        body.put("heapUsedBytes", r.heapUsedBytes());
        body.put("heapMaxBytes", r.heapMaxBytes());
        body.put("heapCommittedBytes", r.heapCommittedBytes());
        body.put("cpuUsagePercent", r.cpuUsagePercent());
        return GSON.toJson(body);
    }

    public static String events(String serverId, long sequence, List<Map<String, Object>> events) {
        Map<String, Object> body = envelope(serverId, sequence);
        body.put("events", events);
        return GSON.toJson(body);
    }

    public static String plugins(String serverId, long sequence, Instant collectedAt, PluginInventory inventory) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("schemaVersion", SCHEMA_VERSION);
        body.put("serverId", serverId);
        body.put("requestId", UUID.randomUUID().toString());
        body.put("sequence", sequence);
        body.put("timestamp", Instant.now().toString());
        body.put("collectedAt", collectedAt.toString());
        body.put("inventoryHash", inventory.inventoryHash());

        List<Map<String, Object>> list = new ArrayList<>(inventory.plugins().size());
        for (PluginEntry p : inventory.plugins()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", p.name());
            entry.put("version", p.version());
            entry.put("enabled", p.enabled());
            entry.put("apiVersion", p.apiVersion());
            list.add(entry);
        }
        body.put("plugins", list);
        return GSON.toJson(body);
    }

    /** Build a structured event map for the event buffer. */
    public static Map<String, Object> event(
            String type, String severity, Instant occurredAt, String summary, Map<String, Object> details) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", type);
        event.put("severity", severity);
        event.put("occurredAt", occurredAt.toString());
        event.put("summary", summary);
        if (details != null && !details.isEmpty()) {
            event.put("details", details);
        }
        return event;
    }
}
