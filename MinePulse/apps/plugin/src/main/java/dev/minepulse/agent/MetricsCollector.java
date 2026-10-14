package dev.minepulse.agent;

import com.sun.management.GarbageCollectionNotificationInfo;
import java.io.File;
import java.lang.management.BufferPoolMXBean;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryPoolMXBean;
import java.lang.management.MemoryType;
import java.lang.management.MemoryUsage;
import java.lang.management.ThreadMXBean;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.management.Notification;
import javax.management.NotificationEmitter;
import javax.management.NotificationListener;
import javax.management.openmbean.CompositeData;
import org.bukkit.Bukkit;
import org.bukkit.World;

/**
 * Reads live server metrics. All methods must be called on the server main
 * thread (the scheduler runs them synchronously) because they touch Bukkit.
 */
public final class MetricsCollector {

    private static final Pattern PAPER_BUILD = Pattern.compile("Paper-(\\d+)");

    /**
     * Most recent GC pause per collector, in milliseconds, populated by JMX
     * notifications. Garbage collection is not observable through the plain
     * MXBean counters alone, so we listen for the notification the JVM emits on
     * every collection.
     */
    private final Map<String, Long> lastGcPauseMs = new ConcurrentHashMap<>();

    /** Always-on sampling profiler for the main server thread + host network. */
    private final PerformanceProfiler profiler = new PerformanceProfiler();

    public MetricsCollector() {
        registerGcListeners();
    }

    /** Stop background sampling (called on plugin disable). */
    public void shutdown() {
        profiler.stop();
    }

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

    /**
     * The address players connect to, as {@code host:port}. Uses server-ip from
     * server.properties when set, otherwise the machine's primary LAN address.
     * This is what the dashboard shows as the server address.
     */
    public String serverAddress() {
        return formatAddress(resolveConnectHost(), Bukkit.getPort());
    }

    /** Normalise a host and port into "host:port", dropping an unset port. */
    static String formatAddress(String host, int port) {
        String trimmed = host == null ? "" : host.trim();
        String resolved = trimmed.isEmpty() ? "localhost" : trimmed;
        return port > 0 ? resolved + ":" + port : resolved;
    }

    /** Prefer an explicit server-ip, then a site-local IPv4, then any local address. */
    private static String resolveConnectHost() {
        String configured = Bukkit.getIp();
        if (configured != null && !configured.isBlank()) {
            return configured.trim();
        }
        try {
            List<String> candidates = new ArrayList<>();
            String siteLocal = null;
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface nic = interfaces.nextElement();
                if (!nic.isUp() || nic.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> addresses = nic.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (!(address instanceof Inet4Address)
                            || address.isLoopbackAddress()
                            || address.isLinkLocalAddress()) {
                        continue;
                    }
                    String host = address.getHostAddress();
                    candidates.add(host);
                    if (address.isSiteLocalAddress() && siteLocal == null) {
                        siteLocal = host;
                    }
                }
            }
            if (siteLocal != null) {
                return siteLocal;
            }
            if (!candidates.isEmpty()) {
                return candidates.get(0);
            }
        } catch (Exception ignored) {
            // No usable interface; fall back to loopback rather than sending nothing.
        }
        return "localhost";
    }

    /**
     * Static host/JVM facts for the heartbeat. Everything here is read from the
     * JVM/OS (never Bukkit), so it is safe to call from any thread, but the
     * scheduler invokes it on the main thread anyway.
     */
    public HostSystem hostSystem() {
        Runtime runtime = Runtime.getRuntime();
        File root = serverRoot();
        return new HostSystem(
                trim(System.getProperty("java.version"), 96),
                trim(System.getProperty("java.vendor"), 96),
                jvmArgs(),
                trim(System.getProperty("os.name"), 128),
                trim(System.getProperty("os.version"), 128),
                trim(System.getProperty("os.arch"), 32),
                runtime.availableProcessors(),
                root != null ? root.getTotalSpace() : null,
                root != null ? root.getUsableSpace() : null);
    }

    private static List<String> jvmArgs() {
        try {
            List<String> args = ManagementFactory.getRuntimeMXBean().getInputArguments();
            List<String> trimmed = new ArrayList<>(args.size());
            for (String arg : args) {
                trimmed.add(trim(arg, 256));
            }
            return trimmed;
        } catch (Throwable ignored) {
            return List.of();
        }
    }

    /** The directory the server runs from, used for disk headroom. */
    private static File serverRoot() {
        try {
            File container = Bukkit.getWorldContainer();
            if (container != null) {
                return container.getAbsoluteFile();
            }
        } catch (Throwable ignored) {
            // Bukkit not ready (e.g. early boot); fall through.
        }
        return new File(System.getProperty("user.dir", ".")).getAbsoluteFile();
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

        MemoryBreakdown memory = readMemoryBreakdown();

        // Sample the main thread (this method runs on it) and drain the interval.
        profiler.start();
        profiler.refreshPlugins(Bukkit.getPluginManager().getPlugins());
        PerformanceProfiler.Snapshot profile = profiler.snapshot();

        return new MetricReading(
                tps1,
                tps5,
                tps15,
                mspt,
                used,
                max,
                total,
                readProcessCpuPercent(),
                readGcStats(),
                memory.nonHeapUsedBytes,
                memory.metaspaceUsedBytes,
                memory.heapOldBytes,
                memory.heapYoungBytes,
                memory.directBufferBytes,
                readThreadCount(),
                readDaemonThreadCount(),
                readEntityCount(),
                readChunkCount(),
                profile.tickBreakdown(),
                profile.pluginTickCost(),
                profile.netRxBytes(),
                profile.netTxBytes());
    }

    private static Double clampTps(double value) {
        if (!Double.isFinite(value) || value < 0) {
            return null;
        }
        return Math.min(20.0, value);
    }

    // ---------------------------------------------------------------- memory

    private record MemoryBreakdown(
            Long nonHeapUsedBytes,
            Long metaspaceUsedBytes,
            Long heapOldBytes,
            Long heapYoungBytes,
            Long directBufferBytes) {
    }

    private MemoryBreakdown readMemoryBreakdown() {
        Long nonHeap = null;
        Long metaspace = null;
        long old = 0;
        long young = 0;
        boolean sawOld = false;
        boolean sawYoung = false;

        try {
            MemoryUsage nonHeapUsage = ManagementFactory.getMemoryMXBean().getNonHeapMemoryUsage();
            if (nonHeapUsage != null && nonHeapUsage.getUsed() >= 0) {
                nonHeap = nonHeapUsage.getUsed();
            }
            for (MemoryPoolMXBean pool : ManagementFactory.getMemoryPoolMXBeans()) {
                MemoryUsage usage = pool.getUsage();
                if (usage == null || usage.getUsed() < 0) {
                    continue;
                }
                long poolUsed = usage.getUsed();
                String name = pool.getName();
                if (isMetaspacePool(name)) {
                    metaspace = poolUsed;
                }
                if (pool.getType() == MemoryType.HEAP) {
                    if (isOldGenPool(name)) {
                        old += poolUsed;
                        sawOld = true;
                    } else if (isYoungGenPool(name)) {
                        young += poolUsed;
                        sawYoung = true;
                    }
                }
            }
        } catch (Throwable ignored) {
            // Pools are best-effort; leave nulls/zeros rather than guessing.
        }

        Long direct = readDirectBufferBytes();
        return new MemoryBreakdown(
                nonHeap,
                metaspace,
                sawOld ? old : null,
                sawYoung ? young : null,
                direct);
    }

    static boolean isMetaspacePool(String name) {
        return name != null && name.toLowerCase(Locale.ROOT).contains("metaspace");
    }

    static boolean isOldGenPool(String name) {
        if (name == null) {
            return false;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.contains("old") || lower.contains("tenured");
    }

    static boolean isYoungGenPool(String name) {
        if (name == null) {
            return false;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.contains("eden") || lower.contains("survivor") || lower.contains("young");
    }

    private static Long readDirectBufferBytes() {
        try {
            long total = 0;
            boolean found = false;
            for (BufferPoolMXBean pool : ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)) {
                if (pool.getName() != null && pool.getName().toLowerCase(Locale.ROOT).contains("direct")) {
                    long used = pool.getMemoryUsed();
                    if (used >= 0) {
                        total += used;
                        found = true;
                    }
                }
            }
            return found ? total : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    // ------------------------------------------------------------------- gc

    private void registerGcListeners() {
        try {
            for (GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
                if (!(bean instanceof NotificationEmitter emitter)) {
                    continue;
                }
                NotificationListener listener = this::onGcNotification;
                try {
                    emitter.addNotificationListener(listener, null, null);
                } catch (Throwable ignored) {
                    // Some collectors do not support listeners; skip them.
                }
            }
        } catch (Throwable ignored) {
            // GC detail is optional; never fail a metrics read over it.
        }
    }

    private void onGcNotification(Notification notification, Object handback) {
        try {
            if (!GarbageCollectionNotificationInfo.GARBAGE_COLLECTION_NOTIFICATION.equals(notification.getType())) {
                return;
            }
            if (!(notification.getUserData() instanceof CompositeData data)) {
                return;
            }
            GarbageCollectionNotificationInfo info = GarbageCollectionNotificationInfo.from(data);
            lastGcPauseMs.put(info.getGcName(), info.getGcInfo().getDuration());
        } catch (Throwable ignored) {
            // Ignore malformed notifications.
        }
    }

    private List<MetricReading.GcStat> readGcStats() {
        try {
            List<GarbageCollectorMXBean> beans = ManagementFactory.getGarbageCollectorMXBeans();
            List<MetricReading.GcStat> stats = new ArrayList<>(beans.size());
            for (GarbageCollectorMXBean bean : beans) {
                long count = Math.max(0, bean.getCollectionCount());
                long time = Math.max(0, bean.getCollectionTime());
                Long last = lastGcPauseMs.get(bean.getName());
                stats.add(new MetricReading.GcStat(
                        bean.getName(),
                        count,
                        (double) time,
                        last != null ? last.doubleValue() : null));
            }
            return stats;
        } catch (Throwable ignored) {
            return List.of();
        }
    }

    // -------------------------------------------------------------- threads

    private static Integer readThreadCount() {
        try {
            ThreadMXBean threads = ManagementFactory.getThreadMXBean();
            return threads.getThreadCount();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Integer readDaemonThreadCount() {
        try {
            ThreadMXBean threads = ManagementFactory.getThreadMXBean();
            return threads.getDaemonThreadCount();
        } catch (Throwable ignored) {
            return null;
        }
    }

    // -------------------------------------------------------------- worlds

    private static Integer readEntityCount() {
        try {
            int total = 0;
            for (World world : Bukkit.getWorlds()) {
                total += world.getEntities().size();
            }
            return total;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Integer readChunkCount() {
        try {
            int total = 0;
            for (World world : Bukkit.getWorlds()) {
                total += world.getLoadedChunks().length;
            }
            return total;
        } catch (Throwable ignored) {
            return null;
        }
    }

    // ----------------------------------------------------------------- cpu

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

    private static String trim(String value, int max) {
        if (value == null) {
            return null;
        }
        String cleaned = value.trim();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > max ? cleaned.substring(0, max) : cleaned;
    }
}
