package dev.minepulse.agent;

import java.util.List;

/**
 * A point-in-time metrics reading. Nullable fields are genuinely unmeasurable;
 * the API stores them as null so the dashboard can show "not available".
 */
public record MetricReading(
        Double tps1m,
        Double tps5m,
        Double tps15m,
        Double mspt,
        long heapUsedBytes,
        long heapMaxBytes,
        long heapCommittedBytes,
        Double cpuUsagePercent,
        List<GcStat> gc,
        Long nonHeapUsedBytes,
        Long metaspaceUsedBytes,
        Long heapOldBytes,
        Long heapYoungBytes,
        Long directBufferBytes,
        Integer threadCount,
        Integer daemonThreadCount,
        Integer entityCount,
        Integer chunkCount,
        List<TickShare> tickBreakdown,
        List<PluginCost> pluginTickCost,
        Long netRxBytes,
        Long netTxBytes) {

    /** Cumulative counters for one garbage collector plus its most recent pause. */
    public record GcStat(String name, long count, double totalMs, Double lastMs) {
    }

    /**
     * One sampled main-thread category. {@code samples} is the number of
     * 100 ms stack samples that landed in this category during the interval;
     * the dashboard turns the totals into percentages.
     */
    public record TickShare(String name, int samples) {
    }

    /** Sampled time attributed to a single plugin, in samples. */
    public record PluginCost(String name, int samples) {
    }
}
