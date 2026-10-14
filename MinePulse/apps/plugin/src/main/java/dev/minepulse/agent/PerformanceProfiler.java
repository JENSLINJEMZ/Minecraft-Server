package dev.minepulse.agent;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.plugin.Plugin;

/**
 * A lightweight always-on sampling profiler for the server main thread, plus a
 * host network counter reader.
 *
 * <p>Every {@value #SAMPLE_INTERVAL_MS} ms a background daemon thread takes a
 * non-suspending stack snapshot of the main server thread via {@link ThreadMXBean}
 * and classifies the top-most frame: plugin-owned frames (matched by the owning
 * plugin's class loader) become per-plugin tick cost, and vanilla/JVM frames are
 * bucketed into tick-work categories (world, entities, chunks, network, idle,
 * other). Between metrics payloads the counts are accumulated, then drained by
 * {@link #snapshot()}.</p>
 *
 * <p>This is the same sampling approach profilers such as spark use; the numbers
 * are measured, never invented. When a category cannot be observed it simply
 * does not appear.</p>
 */
public final class PerformanceProfiler {

    private static final int MAX_DEPTH = 96;
    private static final long SAMPLE_INTERVAL_MS = 100L;
    private static final long NETWORK_INTERVAL_MS = 5000L;
    private static final String SELF_PACKAGE = "dev.minepulse.agent";

    /** Packages that never belong to a plugin; skip the (expensive) owner lookup. */
    private static final List<String> NON_PLUGIN_PREFIXES = List.of(
            "java.", "javax.", "jdk.", "sun.", "com.sun.", "net.minecraft.", "org.bukkit.",
            "io.papermc.", "io.netty.", "com.google.", "com.mojang.", "org.slf4j.",
            "org.apache.logging.", "org.yaml.", "it.unimi.", "com.mysql.", "org.sqlite.",
            "org.postgresql.", "oshi.", "net.java.dev.jna.", "org.jetbrains.", "org.intellij.",
            "com.zaxxer.");

    private final ThreadMXBean threads = ManagementFactory.getThreadMXBean();
    private final Object lock = new Object();
    private final Map<String, Integer> categoryCounts = new HashMap<>();
    private final Map<String, Integer> pluginCounts = new HashMap<>();
    private final Map<String, String> ownerCache = new HashMap<>();
    private volatile Map<ClassLoader, String> pluginLoaders = Map.of();
    private volatile String pluginSignature = "";
    private volatile long mainThreadId = -1L;
    private volatile long netRx = -1L;
    private volatile long netTx = -1L;
    private volatile boolean running;
    private volatile Thread worker;

    /** One drained interval: tick categories, per-plugin cost, network totals. */
    public record Snapshot(
            List<MetricReading.TickShare> tickBreakdown,
            List<MetricReading.PluginCost> pluginTickCost,
            Long netRxBytes,
            Long netTxBytes) {
    }

    /** Start sampling. Must be called from the main server thread (captures its id). */
    public void start() {
        if (running) {
            return;
        }
        mainThreadId = Thread.currentThread().getId();
        running = true;
        Thread thread = new Thread(this::loop, "MinePulse-Profiler");
        thread.setDaemon(true);
        worker = thread;
        thread.start();
    }

    /** Stop sampling; safe to call multiple times. */
    public void stop() {
        running = false;
        Thread thread = worker;
        if (thread != null) {
            thread.interrupt();
        }
    }

    /** Refresh the plugin -> class loader map. Call on the main thread. */
    public void refreshPlugins(Plugin[] plugins) {
        if (plugins == null) {
            return;
        }
        Map<ClassLoader, String> fresh = new HashMap<>();
        StringBuilder signature = new StringBuilder();
        for (Plugin plugin : plugins) {
            ClassLoader loader = plugin.getClass().getClassLoader();
            if (loader == null) {
                continue;
            }
            fresh.put(loader, plugin.getName());
            signature.append(plugin.getName()).append(':').append(System.identityHashCode(loader)).append(';');
        }
        String next = signature.toString();
        if (next.equals(pluginSignature)) {
            return;
        }
        pluginSignature = next;
        pluginLoaders = fresh;
        synchronized (lock) {
            ownerCache.clear();
        }
    }

    /** Drain the accumulated interval and return the measured distribution. */
    public Snapshot snapshot() {
        List<MetricReading.TickShare> tick;
        List<MetricReading.PluginCost> plugins;
        long rx;
        long tx;
        synchronized (lock) {
            tick = toTick(categoryCounts);
            categoryCounts.clear();
            plugins = toPlugins(pluginCounts);
            pluginCounts.clear();
            rx = netRx;
            tx = netTx;
        }
        return new Snapshot(tick, plugins, rx >= 0L ? Long.valueOf(rx) : null, tx >= 0L ? Long.valueOf(tx) : null);
    }

    // ------------------------------------------------------------------ loop

    private void loop() {
        long lastNetwork = 0L;
        while (running) {
            try {
                sampleThread();
                long now = System.currentTimeMillis();
                if (now - lastNetwork >= NETWORK_INTERVAL_MS) {
                    lastNetwork = now;
                    sampleNetwork();
                }
                Thread.sleep(SAMPLE_INTERVAL_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            } catch (Throwable ignored) {
                // Never let a sampling hiccup kill the profiler thread.
            }
        }
    }

    private void sampleThread() {
        long id = mainThreadId;
        if (id < 0L) {
            return;
        }
        ThreadInfo info;
        try {
            info = threads.getThreadInfo(id, MAX_DEPTH);
        } catch (Throwable ignored) {
            return;
        }
        if (info == null) {
            return;
        }
        StackTraceElement[] frames = info.getStackTrace();
        if (frames == null || frames.length == 0) {
            return;
        }

        String category = null;
        String plugin = null;
        for (StackTraceElement frame : frames) {
            String className = frame.getClassName();
            if (className.startsWith(SELF_PACKAGE)) {
                continue;
            }
            String owner = ownerOf(className);
            if (owner != null) {
                category = "Plugins";
                plugin = owner;
                break;
            }
            String mapped = categorize(className, frame.getMethodName());
            if (mapped != null) {
                category = mapped;
                break;
            }
        }
        if (category == null) {
            category = "Other";
        }

        synchronized (lock) {
            categoryCounts.merge(category, 1, Integer::sum);
            if (plugin != null) {
                pluginCounts.merge(plugin, 1, Integer::sum);
            }
        }
    }

    private void sampleNetwork() {
        try {
            NetworkSampler.Counters counters = NetworkSampler.sample();
            if (counters != null) {
                synchronized (lock) {
                    netRx = counters.rxBytes();
                    netTx = counters.txBytes();
                }
            }
        } catch (Throwable ignored) {
            // OSHI unavailable; leave network unknown rather than guessing.
        }
    }

    // --------------------------------------------------------- classification

    private static String categorize(String className, String method) {
        // Idle / waiting for the next tick.
        if (className.equals("java.lang.Thread") && ("sleep".equals(method) || "yield".equals(method))) {
            return "Idle";
        }
        if ("park".equals(method) || "parkNanos".equals(method) || "parkUntil".equals(method)) {
            return "Idle";
        }
        if (className.equals("java.lang.Object") && ("wait".equals(method) || "wait0".equals(method))) {
            return "Idle";
        }

        if (className.startsWith("net.minecraft.world.entity")) {
            return "Entities";
        }
        if (className.startsWith("net.minecraft.world.level.chunk")
                || className.startsWith("net.minecraft.server.level.ChunkMap")
                || className.startsWith("net.minecraft.world.level.chunk.storage")) {
            return "Chunk loading";
        }
        if (className.startsWith("net.minecraft.network") || className.startsWith("io.netty")) {
            return "Network";
        }
        if (className.startsWith("net.minecraft.server.level")
                || className.startsWith("net.minecraft.world.level")) {
            return "World ticking";
        }
        if (className.startsWith("net.minecraft")) {
            return "Other";
        }
        return null;
    }

    /** Resolve the plugin that owns {@code className}, or null for server/JVM code. */
    private String ownerOf(String className) {
        synchronized (lock) {
            String cached = ownerCache.get(className);
            if (cached != null) {
                return cached.isEmpty() ? null : cached;
            }
        }

        String owner = "";
        if (!isClearlyNonPlugin(className)) {
            for (Map.Entry<ClassLoader, String> entry : pluginLoaders.entrySet()) {
                try {
                    Class<?> type = Class.forName(className, false, entry.getKey());
                    if (type.getClassLoader() == entry.getKey()) {
                        owner = entry.getValue();
                        break;
                    }
                } catch (Throwable ignored) {
                    // Not this plugin's class; keep looking.
                }
            }
        }

        synchronized (lock) {
            ownerCache.put(className, owner);
        }
        return owner.isEmpty() ? null : owner;
    }

    private static boolean isClearlyNonPlugin(String className) {
        for (String prefix : NON_PLUGIN_PREFIXES) {
            if (className.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    private static List<MetricReading.TickShare> toTick(Map<String, Integer> counts) {
        List<Map.Entry<String, Integer>> entries = sortedEntries(counts);
        List<MetricReading.TickShare> out = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : entries) {
            out.add(new MetricReading.TickShare(entry.getKey(), entry.getValue()));
            if (out.size() >= 12) {
                break;
            }
        }
        return out;
    }

    private static List<MetricReading.PluginCost> toPlugins(Map<String, Integer> counts) {
        List<Map.Entry<String, Integer>> entries = sortedEntries(counts);
        List<MetricReading.PluginCost> out = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : entries) {
            out.add(new MetricReading.PluginCost(entry.getKey(), entry.getValue()));
            if (out.size() >= 50) {
                break;
            }
        }
        return out;
    }

    private static List<Map.Entry<String, Integer>> sortedEntries(Map<String, Integer> counts) {
        List<Map.Entry<String, Integer>> entries = new ArrayList<>(counts.entrySet());
        entries.removeIf((entry) -> entry.getValue() == null || entry.getValue() <= 0);
        entries.sort((a, b) -> Integer.compare(b.getValue(), a.getValue()));
        return entries;
    }
}
