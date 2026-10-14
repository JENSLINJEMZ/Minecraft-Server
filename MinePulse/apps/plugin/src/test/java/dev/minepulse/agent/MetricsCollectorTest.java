package dev.minepulse.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class MetricsCollectorTest {

    @Test
    void formatsHostAndPort() {
        assertEquals("192.168.1.20:25565", MetricsCollector.formatAddress("192.168.1.20", 25565));
    }

    @Test
    void trimsWhitespaceAroundHost() {
        assertEquals("play.example.com:25565", MetricsCollector.formatAddress("  play.example.com  ", 25565));
    }

    @Test
    void fallsBackToLocalhostWhenHostMissing() {
        assertEquals("localhost:25565", MetricsCollector.formatAddress(null, 25565));
        assertEquals("localhost:25565", MetricsCollector.formatAddress("   ", 25565));
    }

    @Test
    void dropsThePortWhenUnknown() {
        assertEquals("play.example.com", MetricsCollector.formatAddress("play.example.com", 0));
        assertEquals("play.example.com", MetricsCollector.formatAddress("play.example.com", -1));
    }

    @Test
    void identifiesMetaspacePools() {
        assertEquals(true, MetricsCollector.isMetaspacePool("Metaspace"));
        assertEquals(false, MetricsCollector.isMetaspacePool("Compressed Class Space"));
        assertEquals(false, MetricsCollector.isMetaspacePool("G1 Eden Space"));
        assertEquals(false, MetricsCollector.isMetaspacePool(null));
    }

    @Test
    void identifiesOldGenerationPools() {
        assertEquals(true, MetricsCollector.isOldGenPool("G1 Old Gen"));
        assertEquals(true, MetricsCollector.isOldGenPool("PS Old Generation"));
        assertEquals(true, MetricsCollector.isOldGenPool("Tenured Gen"));
        assertEquals(false, MetricsCollector.isOldGenPool("G1 Young Generation"));
        assertEquals(false, MetricsCollector.isOldGenPool("G1 Eden Space"));
    }

    @Test
    void identifiesYoungGenerationPools() {
        assertEquals(true, MetricsCollector.isYoungGenPool("G1 Eden Space"));
        assertEquals(true, MetricsCollector.isYoungGenPool("G1 Survivor Space"));
        assertEquals(true, MetricsCollector.isYoungGenPool("G1 Young Generation"));
        assertEquals(false, MetricsCollector.isYoungGenPool("G1 Old Gen"));
    }
}
