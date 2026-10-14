package dev.minepulse.agent;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.ChatColor;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * MinePulseAgent: streams heartbeats, metrics, structured events and a plugin
 * inventory to a MinePulse API over HTTPS. Collected synchronously on the main
 * thread; delivered asynchronously so the server is never blocked.
 */
public final class MinePulseAgentPlugin extends JavaPlugin {

    private static final int MAX_EVENTS_PER_PAYLOAD = 100;

    private AgentConfig config;
    private AgentHttpClient client;
    private EventBuffer buffer;
    private MetricsCollector metrics;
    private PlayerCollector players;
    private PluginCollector pluginCollector;

    private final AtomicLong sequence = new AtomicLong(0L);
    private final List<BukkitTask> tasks = new ArrayList<>();

    private volatile String serverId = "";
    private volatile boolean serverIdResolved = false;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        config = AgentConfig.from(getConfig());

        metrics = new MetricsCollector();
        players = new PlayerCollector();
        pluginCollector = new PluginCollector();
        buffer = new EventBuffer(config.maxBufferSize());
        client = new AgentHttpClient(config, getLogger());

        getServer().getPluginManager().registerEvents(new PlayerListener(buffer), this);

        MinePulseCommand command = new MinePulseCommand(this);
        if (getCommand("minepulse") != null) {
            getCommand("minepulse").setExecutor(command);
            getCommand("minepulse").setTabCompleter(command);
        }

        getLogger().info("MinePulseAgent " + getDescription().getVersion() + " enabled");

        if (!config.usable()) {
            if (!config.tokenConfigured()) {
                getLogger().warning("No agent-token set - telemetry is DISABLED.");
                getLogger().warning("Create a token with `npm run create-agent-credential`, set it in");
                getLogger().warning("plugins/MinePulseAgent/config.yml, then run /minepulse reload.");
            } else {
                getLogger().warning("api-url is blank - telemetry is DISABLED.");
            }
            return;
        }

        resolveIdentity();
        buffer.add(Payloads.event(
                "server_started",
                "info",
                Instant.now(),
                "Server started (MinePulse agent enabled)",
                Map.of("agentVersion", getDescription().getVersion())));
        scheduleTasks();
    }

    @Override
    public void onDisable() {
        if (metrics != null) {
            metrics.shutdown();
        }
        cancelTasks();
        if (config != null && config.usable() && serverIdResolved && buffer != null) {
            buffer.add(Payloads.event(
                    "server_stopped", "info", Instant.now(), "Server stopping (MinePulse agent disabled)", null));
            flushBlocking();
        }
        getLogger().info("MinePulseAgent disabled");
    }

    private void resolveIdentity() {
        if (config.serverId() != null && !config.serverId().isBlank()) {
            serverId = config.serverId();
            serverIdResolved = true;
            return;
        }
        tryResolveServerId();
    }

    /** Ask the API which server this credential belongs to, then cache it. */
    private void tryResolveServerId() {
        if (serverIdResolved || !config.tokenConfigured()) {
            return;
        }
        client.request("GET", "/api/v1/agent/context", null).thenAccept(result -> {
            if (result.skipped()) {
                return;
            }
            if (!result.ok()) {
                if (config.debugLogging()) {
                    getLogger().warning("Server-id discovery failed: " + result.error());
                }
                return;
            }
            try {
                JsonObject json = JsonParser.parseString(result.body()).getAsJsonObject();
                String id = json.has("serverId") ? json.get("serverId").getAsString() : null;
                if (id != null && !id.isBlank()) {
                    serverId = id.trim();
                    serverIdResolved = true;
                    config = config.withServerId(serverId);
                    client.updateConfig(config);
                    getLogger().info("Discovered serverId " + serverId + " from the API");
                    persistServerId(serverId);
                }
            } catch (RuntimeException ex) {
                getLogger().warning("Could not parse the agent context response: " + ex.getMessage());
            }
        });
    }

    private void persistServerId(String id) {
        if (!isEnabled()) {
            return;
        }
        getServer().getScheduler().runTask(this, () -> {
            getConfig().set("server-id", id);
            saveConfig();
        });
    }

    private void scheduleTasks() {
        cancelTasks();
        long heartbeat = config.heartbeatIntervalSeconds() * 20L;
        long metricsTicks = config.metricsIntervalSeconds() * 20L;
        long pluginsTicks = config.pluginsIntervalSeconds() * 20L;
        long eventsTicks = config.eventsIntervalSeconds() * 20L;

        tasks.add(getServer().getScheduler().runTaskTimer(this, this::tickHeartbeat, 40L, heartbeat));
        tasks.add(getServer().getScheduler().runTaskTimer(this, this::tickMetrics, 60L, metricsTicks));
        tasks.add(getServer().getScheduler().runTaskTimer(this, this::tickPlugins, 100L, pluginsTicks));
        tasks.add(getServer().getScheduler().runTaskTimer(this, this::tickEvents, 120L, eventsTicks));
    }

    private void cancelTasks() {
        for (BukkitTask task : tasks) {
            if (!task.isCancelled()) {
                task.cancel();
            }
        }
        tasks.clear();
    }

    private boolean ready() {
        return serverIdResolved && config.usable();
    }

    private void tickHeartbeat() {
        if (!ready()) {
            tryResolveServerId();
            return;
        }
        List<OnlinePlayer> online = players.online();
        String json = Payloads.heartbeat(
                serverId,
                sequence.incrementAndGet(),
                getDescription().getVersion(),
                metrics.identity(),
                metrics.serverAddress(),
                metrics.uptimeSeconds(),
                metrics.maxPlayers(),
                online,
                metrics.hostSystem());
        send("/api/v1/agent/heartbeat", json, "heartbeat");
    }

    private void tickMetrics() {
        if (!ready()) {
            return;
        }
        String json = Payloads.metrics(serverId, sequence.incrementAndGet(), metrics.read());
        send("/api/v1/agent/metrics", json, "metrics");
    }

    private void tickPlugins() {
        if (!ready()) {
            return;
        }
        PluginInventory inventory = pluginCollector.collect();
        String json = Payloads.plugins(serverId, sequence.incrementAndGet(), Instant.now(), inventory);
        send("/api/v1/agent/plugins", json, "plugins");
    }

    private void tickEvents() {
        if (!ready() || buffer.size() == 0) {
            return;
        }
        List<Map<String, Object>> batch = buffer.drain(MAX_EVENTS_PER_PAYLOAD);
        if (batch.isEmpty()) {
            return;
        }
        String json = Payloads.events(serverId, sequence.incrementAndGet(), batch);
        send("/api/v1/agent/events", json, "events");
    }

    private void send(String path, String json, String label) {
        client.request("POST", path, json).thenAccept(result -> {
            if (result.skipped()) {
                return;
            }
            if (!result.ok()) {
                if (result.status() == 401 || result.status() == 403) {
                    getLogger().warning(
                            "MinePulse rejected the agent token (HTTP " + result.status()
                                    + "). Check agent-token in config.yml.");
                } else if (config.debugLogging()) {
                    getLogger().warning("MinePulse " + label + " failed: " + result.error());
                }
                return;
            }
            if (config.debugLogging()) {
                getLogger().info("MinePulse " + label + " accepted (" + result.status() + ")");
            }
        });
    }

    private void flushBlocking() {
        List<Map<String, Object>> pending = buffer.drain(MAX_EVENTS_PER_PAYLOAD);
        if (pending.isEmpty()) {
            return;
        }
        String json = Payloads.events(serverId, sequence.incrementAndGet(), pending);
        AgentHttpClient.Result result = client.postSync("/api/v1/agent/events", json);
        if (result.ok()) {
            getLogger().info("Flushed " + pending.size() + " buffered event(s) on shutdown");
        } else {
            getLogger().info("Could not flush buffered events on shutdown: " + result.error());
        }
    }

    // ---- command handlers -------------------------------------------------

    void sendStatus(CommandSender sender) {
        sender.sendMessage(ChatColor.GOLD + "MinePulse agent status");
        sender.sendMessage(ChatColor.GRAY + " API URL      : " + ChatColor.WHITE + config.apiUrl());
        sender.sendMessage(ChatColor.GRAY + " Token set    : "
                + color(config.tokenConfigured()) + config.tokenConfigured());
        sender.sendMessage(ChatColor.GRAY + " server-id    : " + ChatColor.WHITE
                + (serverIdResolved ? serverId : "(unresolved)"));
        sender.sendMessage(ChatColor.GRAY + " Backoff      : "
                + (client.isBackedOff()
                        ? ChatColor.RED + "yes (" + (client.backoffRemainingMillis() / 1000) + "s left)"
                        : ChatColor.GREEN + "no"));
        sender.sendMessage(ChatColor.GRAY + " Last success : " + ChatColor.WHITE + ago(client.lastSuccessAtMillis()));
        sender.sendMessage(ChatColor.GRAY + " Last error   : " + ChatColor.WHITE
                + (client.lastError() == null ? "none" : client.lastError()));
        sender.sendMessage(ChatColor.GRAY + " Buffer       : " + ChatColor.WHITE
                + buffer.size() + " queued, " + buffer.droppedCount() + " dropped");
    }

    void forceCycle(CommandSender sender) {
        if (!config.usable()) {
            sender.sendMessage(ChatColor.RED + "Agent is not configured. Set agent-token in config.yml first.");
            return;
        }
        client.resetBackoff();
        tryResolveServerId();
        tickHeartbeat();
        tickMetrics();
        tickPlugins();
        tickEvents();
        sender.sendMessage(ChatColor.GREEN + "MinePulse: sent a test cycle (heartbeat, metrics, plugins, events).");
        sender.sendMessage(ChatColor.GRAY + "Use /minepulse status to confirm delivery.");
    }

    void reloadAgentConfig(CommandSender sender) {
        reloadConfig();
        config = AgentConfig.from(getConfig());
        client.updateConfig(config);
        serverIdResolved = config.serverId() != null && !config.serverId().isBlank();
        serverId = serverIdResolved ? config.serverId() : "";
        if (config.usable()) {
            resolveIdentity();
            scheduleTasks();
        } else {
            cancelTasks();
        }
        sender.sendMessage(ChatColor.GREEN + "MinePulse config reloaded.");
        if (!config.tokenConfigured()) {
            sender.sendMessage(ChatColor.YELLOW + "No agent-token set - telemetry is disabled.");
        }
    }

    private static ChatColor color(boolean value) {
        return value ? ChatColor.GREEN : ChatColor.RED;
    }

    private static String ago(long epochMillis) {
        if (epochMillis <= 0) {
            return "never";
        }
        long seconds = Math.max(0L, (System.currentTimeMillis() - epochMillis) / 1000L);
        if (seconds < 60) {
            return seconds + "s ago";
        }
        long minutes = seconds / 60;
        if (minutes < 60) {
            return minutes + "m ago";
        }
        return (minutes / 60) + "h ago";
    }
}
