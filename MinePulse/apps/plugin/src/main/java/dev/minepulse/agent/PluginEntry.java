package dev.minepulse.agent;

import java.util.List;

/** One installed plugin. */
public record PluginEntry(String name, String version, boolean enabled, String apiVersion) {
}

