package dev.minepulse.agent;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;

/**
 * Small non-blocking HTTP client for the MinePulse API.
 *
 * <p>All telemetry posts go through {@link #request(String, String, String)}.
 * Failures trigger exponential backoff so a down or misconfigured API never
 * spams the log or the network. Nothing here blocks the server main thread:
 * the async path returns a {@link CompletableFuture}.</p>
 */
public final class AgentHttpClient {

    private static final long BASE_BACKOFF_MS = 2_000L;
    private static final long MAX_BACKOFF_MS = 120_000L;

    private final HttpClient http;
    private final Logger logger;
    private final Duration timeout;
    private volatile AgentConfig config;

    private final AtomicInteger consecutiveFailures = new AtomicInteger(0);
    private volatile long nextAttemptAtMillis = 0L;
    private volatile long lastSuccessAtMillis = 0L;
    private volatile long lastErrorAtMillis = 0L;
    private volatile String lastError = null;
    private volatile int lastStatus = 0;

    public AgentHttpClient(AgentConfig config, Logger logger) {
        this.config = config;
        this.logger = logger;
        this.timeout = Duration.ofSeconds(config.requestTimeoutSeconds());
        this.http = HttpClient.newBuilder()
                // Express/Node speaks HTTP/1.1; the JDK client's cleartext HTTP/2
                // upgrade is rejected with "header parser received no bytes".
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(config.requestTimeoutSeconds()))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    public void updateConfig(AgentConfig config) {
        this.config = config;
    }

    /** Result of a single attempt. {@code skipped} means backoff suppressed it. */
    public record Result(boolean ok, boolean skipped, int status, String body, String error) {
        static Result skippedResult() {
            return new Result(false, true, 0, null, null);
        }
    }

    public boolean isBackedOff() {
        return System.currentTimeMillis() < nextAttemptAtMillis;
    }

    public long backoffRemainingMillis() {
        return Math.max(0L, nextAttemptAtMillis - System.currentTimeMillis());
    }

    public void resetBackoff() {
        consecutiveFailures.set(0);
        nextAttemptAtMillis = 0L;
    }

    public int consecutiveFailures() {
        return consecutiveFailures.get();
    }

    public long lastSuccessAtMillis() {
        return lastSuccessAtMillis;
    }

    public long lastErrorAtMillis() {
        return lastErrorAtMillis;
    }

    public String lastError() {
        return lastError;
    }

    public int lastStatus() {
        return lastStatus;
    }

    /** Fire-and-forget POST. Honors backoff. */
    public CompletableFuture<Result> request(String method, String path, String body) {
        if (isBackedOff()) {
            return CompletableFuture.completedFuture(Result.skippedResult());
        }
        return http.sendAsync(build(method, path, body), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
                .handle((resp, err) -> classify(resp, err));
    }

    /** Blocking GET used only for one-time context discovery. */
    public Result getSync(String path) {
        try {
            HttpResponse<String> resp = http.send(
                    build("GET", path, null), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return classify(resp, null);
        } catch (Exception ex) {
            return recordFailure(-1, ex.getClass().getSimpleName() + ": " + ex.getMessage(), false);
        }
    }

    /** Blocking POST used for best-effort flush during server shutdown. */
    public Result postSync(String path, String body) {
        try {
            HttpResponse<String> resp = http.send(
                    build("POST", path, body), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return classify(resp, null);
        } catch (Exception ex) {
            return recordFailure(-1, ex.getClass().getSimpleName() + ": " + ex.getMessage(), false);
        }
    }

    private HttpRequest build(String method, String path, String body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(config.apiUrl() + path))
                .timeout(timeout)
                .header("x-agent-token", config.agentToken())
                .header("x-request-id", UUID.randomUUID().toString())
                .header("accept", "application/json");
        if ("POST".equalsIgnoreCase(method)) {
            builder.header("content-type", "application/json");
            builder.POST(HttpRequest.BodyPublishers.ofString(body == null ? "" : body, StandardCharsets.UTF_8));
        } else {
            builder.GET();
        }
        return builder.build();
    }

    private Result classify(HttpResponse<String> resp, Throwable err) {
        if (err != null) {
            String message = err.getClass().getSimpleName() + ": " + err.getMessage();
            return recordFailure(-1, message, false);
        }
        int status = resp.statusCode();
        lastStatus = status;
        if (status >= 200 && status < 300) {
            consecutiveFailures.set(0);
            nextAttemptAtMillis = 0L;
            lastSuccessAtMillis = System.currentTimeMillis();
            lastError = null;
            return new Result(true, false, status, resp.body(), null);
        }
        String message = "HTTP " + status + " " + abbreviate(resp.body());
        boolean permanent = status == 401 || status == 403 || status == 400;
        return recordFailure(status, message, permanent);
    }

    private Result recordFailure(int status, String message, boolean permanent) {
        int failures = consecutiveFailures.incrementAndGet();
        lastError = message;
        lastErrorAtMillis = System.currentTimeMillis();
        long delay = permanent
                ? MAX_BACKOFF_MS
                : Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (1L << Math.min(failures - 1, 6)));
        nextAttemptAtMillis = System.currentTimeMillis() + delay;
        if (failures == 1) {
            logger.warning("MinePulse request failed (" + message + "); retrying with backoff. "
                    + "Set debug-logging: true in config.yml for details.");
        } else if (config.debugLogging()) {
            logger.warning("MinePulse request failed (attempt " + failures + ": " + message + ")");
        }
        return new Result(false, false, status, null, message);
    }

    private static String abbreviate(String value) {
        if (value == null) {
            return "";
        }
        String oneLine = value.replace('\n', ' ').trim();
        return oneLine.length() > 160 ? oneLine.substring(0, 160) + "…" : oneLine;
    }
}
