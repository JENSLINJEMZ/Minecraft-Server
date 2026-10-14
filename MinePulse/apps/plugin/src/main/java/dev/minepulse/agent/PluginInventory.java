package dev.minepulse.agent;

import java.util.List;

/** A full plugin inventory plus a stable content hash for change detection. */
public record PluginInventory(List<PluginEntry> plugins, String inventoryHash) {
}
