package dev.minepulse.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.List;

/**
 * Polls the API for queued moderation actions, runs them on the main thread and
 * reports the outcome. The API is the queue because the agent never opens an
 * inbound port. The interval is short (a couple of seconds) so actions feel
 * near-instant while no long-lived connection is required.
 */
public final class ActionPoller {

    private final MinePulseAgentPlugin plugin;
    private final AgentHttpClient client;
    private final ModerationExecutor executor;

    private volatile boolean inFlight = false;

    public ActionPoller(MinePulseAgentPlugin plugin, AgentHttpClient client, ModerationExecutor executor) {
        this.plugin = plugin;
        this.client = client;
        this.executor = executor;
    }

    public void poll() {
        if (inFlight || !plugin.ready()) {
            return;
        }
        inFlight = true;
        client.request("GET", "/api/v1/agent/actions", null).whenComplete((result, error) -> {
            inFlight = false;
            if (result == null || result.skipped() || !result.ok()) {
                return;
            }
            try {
                handle(result.body());
            } catch (RuntimeException failure) {
                if (plugin.getConfig().getBoolean("debug-logging", false)) {
                    plugin.getLogger().warning("Could not read moderation actions: " + failure.getMessage());
                }
            }
        });
    }

    private void handle(String body) {
        JsonObject json = JsonParser.parseString(body).getAsJsonObject();

        List<String> muted = new ArrayList<>();
        JsonArray mutedArray = json.getAsJsonArray("mutedUuids");
        if (mutedArray != null) {
            for (JsonElement element : mutedArray) {
                muted.add(element.getAsString());
            }
        }
        executor.setMuted(muted);

        JsonArray actions = json.getAsJsonArray("actions");
        if (actions == null || actions.isEmpty()) {
            return;
        }
        for (JsonElement element : actions) {
            ModerationCommand command = parse(element.getAsJsonObject());
            plugin.getServer().getScheduler().runTask(plugin, () -> run(command));
        }
    }

    private void run(ModerationCommand command) {
        ModerationExecutor.Outcome outcome = executor.execute(command);
        // A plugin state change alters the inventory, so report it right away
        // instead of waiting for the next scheduled inventory push.
        if (outcome.ok() && command.action() != null && command.action().startsWith("plugin_")) {
            plugin.sendPluginInventorySoon();
        }
        String payload = resultPayload(outcome);
        client.request("POST", "/api/v1/agent/actions/" + command.id() + "/result", payload)
                .thenAccept(result -> {
                    if (result.ok() && plugin.getConfig().getBoolean("debug-logging", false)) {
                        plugin.getLogger().info("Action '" + command.action() + "' -> " + outcome.message());
                    }
                });
    }

    private static String resultPayload(ModerationExecutor.Outcome outcome) {
        JsonObject json = new JsonObject();
        json.addProperty("ok", outcome.ok());
        if (outcome.message() != null) {
            json.addProperty("message", outcome.message());
        }
        return json.toString();
    }

    private static ModerationCommand parse(JsonObject json) {
        return new ModerationCommand(
                string(json, "id"),
                string(json, "action"),
                string(json, "targetUuid"),
                string(json, "targetName"),
                string(json, "reason"),
                string(json, "mode"),
                string(json, "text"),
                string(json, "plugin"),
                string(json, "cmd"),
                string(json, "item"),
                intOrNull(json, "amount"),
                jsonValue(json, "items"));
    }

    /** Raw JSON text of an entity value; null when absent or JSON null. */
    private static String jsonValue(JsonObject json, String key) {
        if (json == null || !json.has(key) || json.get(key).isJsonNull()) {
            return null;
        }
        return json.get(key).toString();
    }

    private static Integer intOrNull(JsonObject json, String key) {
        if (json == null || !json.has(key) || json.get(key).isJsonNull()) {
            return null;
        }
        try {
            return json.get(key).getAsInt();
        } catch (NumberFormatException | UnsupportedOperationException | IllegalStateException ignored) {
            return null;
        }
    }

    private static String string(JsonObject json, String key) {
        if (json == null || !json.has(key) || json.get(key).isJsonNull()) {
            return null;
        }
        return json.get(key).getAsString();
    }
}
