package dev.minepulse.agent;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Pending jar moves that could not be applied immediately.
 *
 * Windows refuses to rename a jar that the running server has open, so a plugin
 * that is loaded right now cannot be moved while it runs. The intent is stored
 * in the agent's data folder and applied by a shutdown hook: by then Paper has
 * disabled every plugin and closed their class loaders, so the files are free.
 *
 * Unloaded jars never come through here - they are moved straight away, because
 * nothing holds them open.
 */
final class StagedJars {

    /** Lower-case plugin name -> jar file name inside plugins/. */
    private static final Map<String, String> PENDING = new LinkedHashMap<>();

    private static Path pluginsDir;
    private static Path file;

    private StagedJars() {
    }

    /** Loads the intent file; called once when the agent enables. */
    static synchronized void init(Path pluginsFolder, Path dataFolder) {
        pluginsDir = pluginsFolder;
        file = dataFolder == null ? null : dataFolder.resolve("staged-jars.properties");
        PENDING.clear();
        if (file == null || !Files.isRegularFile(file)) {
            return;
        }
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            props.load(in);
        } catch (IOException ignored) {
            return;
        }
        for (String name : props.stringPropertyNames()) {
            String jar = props.getProperty(name);
            if (name.isBlank() || jar == null || jar.isBlank()) {
                continue;
            }
            PENDING.put(name.trim().toLowerCase(Locale.ROOT), jar.trim());
        }
    }

    /** Lower-case names of plugins whose disable is waiting for the next stop. */
    static synchronized Set<String> pendingDisables() {
        return Set.copyOf(PENDING.keySet());
    }

    static synchronized boolean hasPendingDisable(String name) {
        return name != null && PENDING.containsKey(name.trim().toLowerCase(Locale.ROOT));
    }

    static synchronized void addPendingDisable(String name, String jarFileName) {
        if (name == null || jarFileName == null || name.isBlank() || jarFileName.isBlank()) {
            return;
        }
        PENDING.put(name.trim().toLowerCase(Locale.ROOT), jarFileName.trim());
        save();
    }

    static synchronized void clearPendingDisable(String name) {
        if (name != null && PENDING.remove(name.trim().toLowerCase(Locale.ROOT)) != null) {
            save();
        }
    }

    /**
     * Moves every pending jar out of the load path. Runs from a JVM shutdown
     * hook, so every plugin jar has been released by the server by now.
     */
    static void applyPending(Consumer<String> log) {
        Path root;
        List<Map.Entry<String, String>> jobs;
        synchronized (StagedJars.class) {
            root = pluginsDir;
            jobs = new ArrayList<>(PENDING.entrySet());
        }
        if (root == null || jobs.isEmpty()) {
            return;
        }
        Path disabledDir = root.resolveSibling(PluginFiles.DISABLED_FOLDER);
        try {
            Files.createDirectories(disabledDir);
        } catch (IOException failure) {
            log.accept("Could not create " + PluginFiles.DISABLED_FOLDER + ": " + failure.getMessage());
            return;
        }
        for (Map.Entry<String, String> job : jobs) {
            Path source = root.resolve(job.getValue());
            if (!Files.isRegularFile(source)) {
                // Already moved (or deleted by hand): the intent is satisfied.
                synchronized (StagedJars.class) {
                    PENDING.remove(job.getKey());
                }
                continue;
            }
            try {
                Files.move(source, disabledDir.resolve(job.getValue()), StandardCopyOption.REPLACE_EXISTING);
                synchronized (StagedJars.class) {
                    PENDING.remove(job.getKey());
                }
                log.accept("Staged disable applied: " + job.getValue());
            } catch (IOException failure) {
                log.accept("Could not move " + job.getValue() + " on shutdown: " + failure.getMessage());
            }
        }
        save();
    }

    private static synchronized void save() {
        if (file == null) {
            return;
        }
        Properties props = new Properties();
        props.putAll(PENDING);
        try {
            Files.createDirectories(file.getParent());
            try (OutputStream out = Files.newOutputStream(file)) {
                props.store(out, "MinePulse staged plugin changes");
            }
        } catch (IOException ignored) {
            // Best effort: the change still applies to this server session.
        }
    }
}
