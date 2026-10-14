package dev.minepulse.agent;

/** One installed plugin. */
public record PluginEntry(
        String name,
        String version,
        boolean enabled,
        String apiVersion,
        String author,
        int commandCount) {
}
