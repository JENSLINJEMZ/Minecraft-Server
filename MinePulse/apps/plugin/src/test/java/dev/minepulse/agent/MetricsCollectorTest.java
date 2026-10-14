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
}
