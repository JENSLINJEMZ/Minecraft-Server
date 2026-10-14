package dev.minepulse.agent;

/** A point-in-time metrics reading. Nullable fields are genuinely unmeasurable. */
public record MetricReading(
        Double tps1m,
        Double tps5m,
        Double tps15m,
        Double mspt,
        long heapUsedBytes,
        long heapMaxBytes,
        long heapCommittedBytes,
        Double cpuUsagePercent) {
}
