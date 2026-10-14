package dev.minepulse.agent;

import org.bukkit.configuration.file.FileConfiguration;

/**
 * Immutable agent configuration read from config.yml.
 *
 * <p>Validation is lenient: the plugin always loads, but telemetry is only sent
 * once {@code agent-token} is configured. {@link #usable()} tells the caller
 * whether the agent is ready to send.</p>
 */
public record AgentConfig(
        String apiUrl,
        String agentToken,
        String serverId,
        int heartbeatIntervalSeconds,
        int metricsIntervalSeconds,
        int pluginsIntervalSeconds,
        int eventsIntervalSeconds,
        int commandPollIntervalSeconds,
        int requestTimeoutSeconds,
        int maxBufferSize,
        boolean debugLogging) {

    private static int clamp(int value, int min, int max, int fallback) {
        if (value <= 0) {
            return fallback;
        }
        return Math.max(min, Math.min(max, value));
    }

    public static AgentConfig from(FileConfiguration cfg) {
        String apiUrl = cfg.getString("api-url", "http://127.0.0.1:4000");
        if (apiUrl == null) {
            apiUrl = "http://127.0.0.1:4000";
        }
        apiUrl = apiUrl.trim();
        while (apiUrl.endsWith("/")) {
            apiUrl = apiUrl.substring(0, apiUrl.length() - 1);
        }

        String token = cfg.getString("agent-token", "");
        token = token == null ? "" : token.trim();

        String serverId = cfg.getString("server-id", "");
        serverId = serverId == null ? "" : serverId.trim();

        return new AgentConfig(
                apiUrl,
                token,
                serverId,
                clamp(cfg.getInt("heartbeat-interval-seconds", 15), 5, 3600, 15),
                clamp(cfg.getInt("metrics-interval-seconds", 10), 5, 3600, 10),
                clamp(cfg.getInt("plugins-interval-seconds", 300), 30, 86400, 300),
                clamp(cfg.getInt("events-interval-seconds", 5), 2, 600, 5),
                clamp(cfg.getInt("command-poll-interval-seconds", 1), 1, 60, 1),
                clamp(cfg.getInt("request-timeout-seconds", 5), 1, 60, 5),
                clamp(cfg.getInt("max-buffer-size", 500), 10, 100000, 500),
                cfg.getBoolean("debug-logging", false));
    }

    public AgentConfig withServerId(String resolved) {
        return new AgentConfig(
                apiUrl,
                agentToken,
                resolved,
                heartbeatIntervalSeconds,
                metricsIntervalSeconds,
                pluginsIntervalSeconds,
                eventsIntervalSeconds,
                commandPollIntervalSeconds,
                requestTimeoutSeconds,
                maxBufferSize,
                debugLogging);
    }

    public boolean tokenConfigured() {
        return !agentToken.isBlank();
    }

    /** True when the agent has everything it needs to begin reporting. */
    public boolean usable() {
        return tokenConfigured() && !apiUrl.isBlank();
    }
}
