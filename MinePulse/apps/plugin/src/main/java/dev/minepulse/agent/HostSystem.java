package dev.minepulse.agent;

import java.util.List;

/**
 * Static (or slowly changing) host/JVM facts. Reported with heartbeats rather
 * than every metrics sample, so the values are not duplicated across the whole
 * time series. Any field may be null when the platform does not expose it.
 */
public record HostSystem(
        String javaVersion,
        String javaVendor,
        List<String> jvmArgs,
        String osName,
        String osVersion,
        String osArch,
        Integer cpuCores,
        Long diskTotalBytes,
        Long diskUsableBytes) {
}
