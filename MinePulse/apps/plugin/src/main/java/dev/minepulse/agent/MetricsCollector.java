package dev.minepulse.agent;

import java.lang.management.ManagementFactory;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;

/**
 * Reads live server metrics. All methods must be called on the server main
 * thread (the scheduler runs them synchronously) because they touch Bukkit.
 */
public final class MetricsCollector {

    private static final Pattern PAPER_BUILD = Pattern.compile("Paper-(\\d+)");

    public ServerIdentity identity() {
        String bukkitVersion = Bukkit.getBukkitVersion(); // e.g. "26.3-R0.1-SNAPSHOT"
        String minecraftVersion = bukkitVersion;
        int dash = bukkitVersion.indexOf('-');
        if (dash > 0) {
            minecraftVersion = bukkitVersion.substring(0, dash);
        }

        String raw = Bukkit.getVersion(); // e.g. "git-Paper-166 (MC: 26.3)"
        Matcher matcher = PAPER_BUILD.matcher(raw);
        String paperVersion = matcher.find() ? minecraftVersion + "-" + matcher.group(1) : raw;
        if (paperVersion.length() > 64) {
            paperVersion = paperVersion.substring(0, 64);
        }
        return new ServerIdentity(minecraftVersion, paperVersion);
    }

    public long uptimeSeconds() {
        return ManagementFactory.getRuntimeMXBean().getUptime() / 1000L;
    }

    public int maxPlayers() {
        return Bukkit.getMaxPlayers();
    }

    public MetricReading read() {
        double[] tps = Bukkit.getTPS();
        Double tps1 = tps.length > 0 ? clampTps(tps[0]) : null;
        Double tps5 = tps.length > 1 ? clampTps(tps[1]) : null;
        Double tps15 = tps.length > 2 ? clampTps(tps[2]) : null;

        double rawMspt = Bukkit.getAverageTickTime();
        Double mspt = Double.isFinite(rawMspt) && rawMspt >= 0 ? rawMspt : null;

        Runtime runtime = Runtime.getRuntime();
        long max = runtime.maxMemory();
        long total = runtime.totalMemory();
        long used = total - runtime.freeMemory();

        return new MetricReading(tps1, tps5, tps15, mspt, used, max, total, readProcessCpuPercent());
    }

    private static Double clampTps(double value) {
        if (!Double.isFinite(value) || value < 0) {
            return null;
        }
        return Math.min(20.0, value);
    }

    /**
     * Best-effort JVM process CPU load, resolved through the exported
     * {@code com.sun.management} interface. Reflecting on the internal
     * implementation class is blocked by the module system, so we look the
     * method up on the public interface instead. Returns null when unavailable,
     * so the dashboard can show "Unavailable" honestly.
     */
    private static Double readProcessCpuPercent() {
        try {
            java.lang.management.OperatingSystemMXBean os =
                    ManagementFactory.getOperatingSystemMXBean();
            Class<?> sunBean = Class.forName("com.sun.management.OperatingSystemMXBean");
            if (!sunBean.isInstance(os)) {
                return null;
            }
            Object value = sunBean.getMethod("getProcessCpuLoad").invoke(os);
            if (value instanceof Double load && Double.isFinite(load) && load >= 0.0) {
                return Math.min(100.0, load * 100.0);
            }
        } catch (Throwable ignored) {
            // Not available on this JVM; report null rather than a fake number.
        }
        return null;
    }
}
