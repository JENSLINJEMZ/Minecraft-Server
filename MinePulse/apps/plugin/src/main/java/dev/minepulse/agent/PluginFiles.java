package dev.minepulse.agent;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Jar-level view of the plugin folders.
 *
 * Paper only loads jars that sit directly in {@code plugins/}, so a plugin is
 * disabled by moving its jar into a sibling {@code plugins-disabled/} folder and
 * enabled by moving it back. Nothing is loaded or unloaded in a running JVM:
 * Paper closes a plugin's class loader when it is disabled, and re-enabling the
 * same instance reuses that closed loader, which breaks class lookups for every
 * plugin in the loader group (observed breaking player logins), so the change is
 * always applied by the next server start.
 *
 * Reading is deliberately forgiving: the jar metadata is only used to identify
 * a jar and to describe plugins that are not loaded, so a plugin.yml that cannot
 * be parsed falls back to the file name instead of failing the inventory.
 */
final class PluginFiles {

    static final String DISABLED_FOLDER = "plugins-disabled";
    /** The agent's own jar is never moved; that would stop all reporting. */
    static final String AGENT_PLUGIN = "MinePulseAgent";

    private static final int MAX_YAML_BYTES = 16 * 1024;
    private static final int MAX_CACHE_ENTRIES = 512;
    private static final int MAX_COMMANDS = 10_000;

    private static final Pattern TOP_LEVEL = Pattern.compile("^([A-Za-z][A-Za-z0-9_-]*):(.*)$");
    private static final Pattern LIST_ITEM = Pattern.compile("^\\s+-\\s*(.+)$");
    private static final Pattern COMMAND_KEY = Pattern.compile("^ {1,4}([A-Za-z0-9_.-]+):.*$");

    /** One parsed plugin jar. */
    record JarInfo(Path path, String name, String version, String apiVersion, String author, int commandCount) {
    }

    /** Parsed jars keyed by path+size+mtime, so the periodic scan does not re-read YAML. */
    private static final Map<String, JarInfo> CACHE = new HashMap<>();

    private final Path pluginsDir;
    private final Path disabledDir;

    PluginFiles(Path pluginsDir) {
        this.pluginsDir = pluginsDir;
        this.disabledDir = pluginsDir.resolveSibling(DISABLED_FOLDER);
    }

    /** Jars Paper would load on the next start. */
    List<JarInfo> enabledJars() {
        return scan(pluginsDir);
    }

    /** Jars staged out of the load path. */
    List<JarInfo> disabledJars() {
        return scan(disabledDir);
    }

    Optional<JarInfo> findEnabled(String name) {
        return find(enabledJars(), name);
    }

    Optional<JarInfo> findDisabled(String name) {
        return find(disabledJars(), name);
    }

    /** Move a jar out of the load path; Paper stops loading it on the next start. */
    void stageDisable(JarInfo jar) throws IOException {
        Files.createDirectories(disabledDir);
        Files.move(jar.path(), disabledDir.resolve(jar.path().getFileName()), StandardCopyOption.REPLACE_EXISTING);
    }

    /** Move a jar back into the load path; Paper loads it on the next start. */
    void stageEnable(JarInfo jar) throws IOException {
        Files.createDirectories(pluginsDir);
        Files.move(jar.path(), pluginsDir.resolve(jar.path().getFileName()), StandardCopyOption.REPLACE_EXISTING);
    }

    static boolean isAgentJar(JarInfo jar) {
        return jar.name().equalsIgnoreCase(AGENT_PLUGIN)
                || jar.path().getFileName().toString().toLowerCase(Locale.ROOT)
                        .startsWith(AGENT_PLUGIN.toLowerCase(Locale.ROOT));
    }

    private static Optional<JarInfo> find(List<JarInfo> jars, String name) {
        if (name == null || name.isBlank()) {
            return Optional.empty();
        }
        String wanted = name.trim().toLowerCase(Locale.ROOT);
        for (JarInfo jar : jars) {
            if (jar.name().toLowerCase(Locale.ROOT).equals(wanted)) {
                return Optional.of(jar);
            }
        }
        return Optional.empty();
    }

    private static List<JarInfo> scan(Path dir) {
        List<JarInfo> jars = new ArrayList<>();
        if (!Files.isDirectory(dir)) {
            return jars;
        }
        try (var stream = Files.list(dir)) {
            stream.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar"))
                    .sorted()
                    .forEach(p -> {
                        JarInfo info = describe(p);
                        if (info != null) {
                            jars.add(info);
                        }
                    });
        } catch (IOException ignored) {
            // A missing or unreadable folder simply contributes no jars.
            return List.of();
        }
        return jars;
    }

    private static JarInfo describe(Path jar) {
        String key;
        try {
            key = jar.toAbsolutePath() + "|" + Files.size(jar) + "|" + Files.getLastModifiedTime(jar).toMillis();
        } catch (IOException unreadable) {
            return null;
        }
        synchronized (CACHE) {
            JarInfo cached = CACHE.get(key);
            if (cached != null) {
                return cached;
            }
        }
        JarInfo info = read(jar);
        synchronized (CACHE) {
            if (CACHE.size() >= MAX_CACHE_ENTRIES) {
                CACHE.clear();
            }
            CACHE.put(key, info);
        }
        return info;
    }

    private static JarInfo read(Path jar) {
        String name = null;
        String version = null;
        String apiVersion = null;
        String author = null;
        int commandCount = 0;
        try (JarFile file = new JarFile(jar.toFile())) {
            JarEntry descriptor = file.getJarEntry("paper-plugin.yml");
            if (descriptor == null) {
                descriptor = file.getJarEntry("plugin.yml");
            }
            if (descriptor != null) {
                String yaml;
                try (InputStream in = file.getInputStream(descriptor)) {
                    yaml = new String(in.readNBytes(MAX_YAML_BYTES), StandardCharsets.UTF_8);
                }
                name = scalar(yaml, "name");
                version = scalar(yaml, "version");
                apiVersion = scalar(yaml, "api-version");
                author = author(yaml);
                commandCount = commandCount(yaml);
            }
        } catch (IOException | RuntimeException ignored) {
            // Not a readable jar: fall back to the file name below.
        }
        String fileName = jar.getFileName().toString();
        if (isBlank(name)) {
            name = basename(fileName);
        }
        if (isBlank(version)) {
            version = versionFromName(fileName);
        }
        return new JarInfo(jar, clip(name, 128), clip(version, 64), clip(apiVersion, 32), clip(author, 128),
                commandCount);
    }

    private static String scalar(String yaml, String key) {
        for (String line : yaml.split("\\R")) {
            Matcher matcher = TOP_LEVEL.matcher(line);
            if (matcher.matches() && matcher.group(1).equalsIgnoreCase(key)) {
                return unquote(matcher.group(2).trim());
            }
        }
        return null;
    }

    private static String author(String yaml) {
        String[] lines = yaml.split("\\R");
        for (int i = 0; i < lines.length; i++) {
            Matcher matcher = TOP_LEVEL.matcher(lines[i]);
            if (!matcher.matches()) {
                continue;
            }
            String key = matcher.group(1).toLowerCase(Locale.ROOT);
            if (!key.equals("author") && !key.equals("authors")) {
                continue;
            }
            String inline = unquote(matcher.group(2).trim());
            if (!inline.isEmpty()) {
                if (!inline.startsWith("[")) {
                    return clip(inline, 128);
                }
                String body = inline.endsWith("]") ? inline.substring(1, inline.length() - 1) : inline.substring(1);
                List<String> names = new ArrayList<>();
                for (String part : body.split(",")) {
                    String value = unquote(part);
                    if (!value.isEmpty()) {
                        names.add(value);
                    }
                }
                return clip(String.join(", ", names), 128);
            }
            List<String> names = new ArrayList<>();
            for (int j = i + 1; j < lines.length; j++) {
                if (lines[j].isBlank()) {
                    continue;
                }
                if (!lines[j].startsWith(" ") && !lines[j].startsWith("\t")) {
                    break;
                }
                Matcher item = LIST_ITEM.matcher(lines[j]);
                if (item.matches()) {
                    String value = unquote(item.group(1));
                    if (!value.isEmpty()) {
                        names.add(value);
                    }
                }
            }
            return clip(String.join(", ", names), 128);
        }
        return null;
    }

    private static int commandCount(String yaml) {
        String[] lines = yaml.split("\\R");
        for (int i = 0; i < lines.length; i++) {
            Matcher matcher = TOP_LEVEL.matcher(lines[i]);
            if (!matcher.matches() || !matcher.group(1).equalsIgnoreCase("commands")) {
                continue;
            }
            int count = 0;
            for (int j = i + 1; j < lines.length && count < MAX_COMMANDS; j++) {
                if (lines[j].isBlank()) {
                    continue;
                }
                if (!lines[j].startsWith(" ") && !lines[j].startsWith("\t")) {
                    break;
                }
                if (COMMAND_KEY.matcher(lines[j]).matches()) {
                    count++;
                }
            }
            return count;
        }
        return 0;
    }

    private static String unquote(String raw) {
        String value = raw.trim();
        int comment = value.indexOf(" #");
        if (comment >= 0) {
            value = value.substring(0, comment).trim();
        }
        if (value.length() >= 2) {
            char first = value.charAt(0);
            char last = value.charAt(value.length() - 1);
            if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
                value = value.substring(1, value.length() - 1);
            }
        }
        return value;
    }

    /** `HeadDrop-3.1.0.jar` -> `HeadDrop`; used when plugin.yml cannot be read. */
    private static String basename(String fileName) {
        String base = fileName.toLowerCase(Locale.ROOT).endsWith(".jar")
                ? fileName.substring(0, fileName.length() - 4)
                : fileName;
        String stripped = base.replaceFirst("-\\d[^/\\\\]*$", "");
        return stripped.isBlank() ? base : stripped;
    }

    private static String versionFromName(String fileName) {
        String base = fileName.endsWith(".jar") ? fileName.substring(0, fileName.length() - 4) : fileName;
        int dash = base.lastIndexOf('-');
        return dash >= 0 && dash < base.length() - 1 ? base.substring(dash + 1) : "unknown";
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String clip(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() > max ? trimmed.substring(0, max) : trimmed;
    }
}
