package dev.minepulse.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class PluginCollectorTest {

    private static PluginEntry entry(String name, String version) {
        return new PluginEntry(name, version, true, "26.3", "MinePulse", 3);
    }

    @Test
    void hashIsDeterministicForIdenticalInventories() {
        List<PluginEntry> a = List.of(entry("EssentialsX", "2.20.1"), entry("LuckPerms", "5.4.0"));
        List<PluginEntry> b = List.of(entry("EssentialsX", "2.20.1"), entry("LuckPerms", "5.4.0"));

        assertEquals(PluginCollector.hash(a), PluginCollector.hash(b));
    }

    @Test
    void hashChangesWhenAVersionChanges() {
        List<PluginEntry> before = List.of(entry("EssentialsX", "2.20.1"));
        List<PluginEntry> after = List.of(entry("EssentialsX", "2.20.2"));

        assertNotEquals(PluginCollector.hash(before), PluginCollector.hash(after));
    }

    @Test
    void hashIsSixtyFourHexCharacters() {
        String hash = PluginCollector.hash(List.of(entry("MinePulseAgent", "0.1.0")));

        assertEquals(64, hash.length());
        assertEquals(hash.toLowerCase(), hash);
        assertTrue(hash.matches("[0-9a-f]{64}"));
    }

    @Test
    void hashHandlesNullApiVersion() {
        List<PluginEntry> entries = List.of(new PluginEntry("Legacy", "1.0", false, null, null, 0));

        assertEquals(64, PluginCollector.hash(entries).length());
    }
}
