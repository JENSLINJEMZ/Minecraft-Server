package dev.minepulse.agent;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginDescriptionFile;

/** Builds the installed-plugin inventory plus a content hash. Main thread only. */
public final class PluginCollector {

    public PluginInventory collect() {
        Plugin[] installed = Bukkit.getPluginManager().getPlugins();
        List<PluginEntry> entries = new ArrayList<>(installed.length);

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
            entries.add(new PluginEntry(plugin.getName(), version, plugin.isEnabled(), apiVersion, author, commandCount));
        }

        entries.sort(Comparator.comparing(PluginEntry::name, String.CASE_INSENSITIVE_ORDER));
        return new PluginInventory(entries, hash(entries));
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

    /** Stable SHA-256 over name|version|enabled|api|author|commands lines (sorted). */
    static String hash(List<PluginEntry> entries) {
        StringBuilder sb = new StringBuilder();
        for (PluginEntry entry : entries) {
            sb.append(entry.name().toLowerCase(Locale.ROOT))
                    .append('|').append(entry.version())
                    .append('|').append(entry.enabled())
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
