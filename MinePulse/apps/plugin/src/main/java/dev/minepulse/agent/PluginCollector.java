package dev.minepulse.agent;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginDescriptionFile;

/** Builds the installed-plugin inventory plus a content hash. Main thread only. */
public final class PluginCollector {

    public PluginInventory collect() {
        PluginFiles files = new PluginFiles(Bukkit.getPluginsFolder().toPath());

        // Jars whose change is already on disk. A jar in the disabled folder is
        // a pending (or already applied) disable; a jar in the load path that
        // Paper did not load is a pending enable. A loaded jar cannot be moved
        // while Windows holds it open, so its disable lives in StagedJars.
        Map<String, PluginFiles.JarInfo> disabled = index(files.disabledJars());
        Map<String, PluginFiles.JarInfo> loadable = index(files.enabledJars());
        Set<String> pendingDisables = StagedJars.pendingDisables();

        Plugin[] installed = Bukkit.getPluginManager().getPlugins();
        List<PluginEntry> entries = new ArrayList<>(installed.length + disabled.size());
        Set<String> seen = new HashSet<>();

        for (Plugin plugin : installed) {
            PluginDescriptionFile description = plugin.getDescription();
            String version = description.getVersion();
            if (version == null || version.isBlank()) {
                version = "unknown";
            }
            if (version.length() > 64) {
                version = version.substring(0, 64);
            }
            String apiVersion = description.getAPIVersion();
            if (apiVersion != null && apiVersion.length() > 32) {
                apiVersion = apiVersion.substring(0, 32);
            }
            String author = authors(description);
            int commandCount = description.getCommands() == null ? 0 : description.getCommands().size();
            String key = plugin.getName().toLowerCase(Locale.ROOT);
            boolean stagedDisable = pendingDisables.contains(key) || disabled.containsKey(key);
            entries.add(new PluginEntry(plugin.getName(), version, plugin.isEnabled(),
                    stagedDisable ? "disable" : null, apiVersion, author, commandCount));
            seen.add(key);
        }

        for (PluginFiles.JarInfo jar : disabled.values()) {
            // A staged disable is still loaded, so the live entry above wins.
            if (seen.contains(jar.name().toLowerCase(Locale.ROOT))) {
                continue;
            }
            entries.add(new PluginEntry(jar.name(), jar.version(), false, null, jar.apiVersion(), jar.author(),
                    jar.commandCount()));
        }

        for (PluginFiles.JarInfo jar : loadable.values()) {
            // Jar present but not loaded: an enable waiting for the next start.
            if (seen.contains(jar.name().toLowerCase(Locale.ROOT))) {
                continue;
            }
            entries.add(new PluginEntry(jar.name(), jar.version(), false, "enable", jar.apiVersion(), jar.author(),
                    jar.commandCount()));
        }

        entries.sort(Comparator.comparing(PluginEntry::name, String.CASE_INSENSITIVE_ORDER));
        return new PluginInventory(entries, hash(entries));
    }

    private static Map<String, PluginFiles.JarInfo> index(List<PluginFiles.JarInfo> jars) {
        Map<String, PluginFiles.JarInfo> byName = new HashMap<>();
        for (PluginFiles.JarInfo jar : jars) {
            byName.putIfAbsent(jar.name().toLowerCase(Locale.ROOT), jar);
        }
        return byName;
    }

    /** Joins a plugin's declared authors, truncated so the payload stays bounded. */
    private static String authors(PluginDescriptionFile description) {
        List<String> authors = description.getAuthors();
        if (authors == null || authors.isEmpty()) {
            return null;
        }
        StringBuilder joined = new StringBuilder();
        for (String author : authors) {
            if (author == null || author.isBlank()) {
                continue;
            }
            if (joined.length() > 0) {
                joined.append(", ");
            }
            joined.append(author.trim());
        }
        if (joined.length() == 0) {
            return null;
        }
        return joined.length() > 128 ? joined.substring(0, 128) : joined.toString();
    }

    /** Stable SHA-256 over name|version|enabled|staged|api|author|commands lines (sorted). */
    static String hash(List<PluginEntry> entries) {
        StringBuilder sb = new StringBuilder();
        for (PluginEntry entry : entries) {
            sb.append(entry.name().toLowerCase(Locale.ROOT))
                    .append('|').append(entry.version())
                    .append('|').append(entry.enabled())
                    .append('|').append(entry.staged() == null ? "" : entry.staged())
                    .append('|').append(entry.apiVersion() == null ? "" : entry.apiVersion())
                    .append('|').append(entry.author() == null ? "" : entry.author())
                    .append('|').append(entry.commandCount())
                    .append('\n');
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            // SHA-256 is always available; fall back to a length-based marker.
            return "len-" + sb.length();
        }
    }
}
