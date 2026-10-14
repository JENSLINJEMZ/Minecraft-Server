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
            String serverAddress,
            long uptimeSeconds,
            int maxPlayers,
            List<OnlinePlayer> online,
            HostSystem system) {

        Map<String, Object> body = envelope(serverId, sequence);
        body.put("agentVersion", agentVersion);
        body.put("minecraftVersion", identity.minecraftVersion());
        body.put("paperVersion", identity.paperVersion());
        body.put("serverAddress", serverAddress);
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

        if (system != null) {
            Map<String, Object> sys = new LinkedHashMap<>();
            sys.put("javaVersion", system.javaVersion());
            sys.put("javaVendor", system.javaVendor());
            sys.put("jvmArgs", system.jvmArgs());
            sys.put("osName", system.osName());
            sys.put("osVersion", system.osVersion());
            sys.put("osArch", system.osArch());
            sys.put("cpuCores", system.cpuCores());
            sys.put("diskTotalBytes", system.diskTotalBytes());
            sys.put("diskUsableBytes", system.diskUsableBytes());
            body.put("system", sys);
        }
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

        if (r.gc() != null && !r.gc().isEmpty()) {
            List<Map<String, Object>> collectors = new ArrayList<>(r.gc().size());
            for (MetricReading.GcStat gc : r.gc()) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("name", gc.name());
                entry.put("count", gc.count());
                entry.put("totalMs", gc.totalMs());
                entry.put("lastMs", gc.lastMs());
                collectors.add(entry);
            }
            body.put("gc", collectors);
        }
        body.put("nonHeapUsedBytes", r.nonHeapUsedBytes());
        body.put("metaspaceUsedBytes", r.metaspaceUsedBytes());
        body.put("heapOldBytes", r.heapOldBytes());
        body.put("heapYoungBytes", r.heapYoungBytes());
        body.put("directBufferBytes", r.directBufferBytes());
        body.put("threadCount", r.threadCount());
        body.put("daemonThreadCount", r.daemonThreadCount());
        body.put("entityCount", r.entityCount());
        body.put("chunkCount", r.chunkCount());

        if (r.tickBreakdown() != null && !r.tickBreakdown().isEmpty()) {
            List<Map<String, Object>> categories = new ArrayList<>(r.tickBreakdown().size());
            for (MetricReading.TickShare share : r.tickBreakdown()) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("name", share.name());
                entry.put("samples", share.samples());
                categories.add(entry);
            }
            body.put("tickBreakdown", categories);
        }
        if (r.pluginTickCost() != null && !r.pluginTickCost().isEmpty()) {
            List<Map<String, Object>> plugins = new ArrayList<>(r.pluginTickCost().size());
            for (MetricReading.PluginCost cost : r.pluginTickCost()) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("name", cost.name());
                entry.put("samples", cost.samples());
                plugins.add(entry);
            }
            body.put("pluginTickCost", plugins);
        }
        body.put("netRxBytes", r.netRxBytes());
        body.put("netTxBytes", r.netTxBytes());
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
