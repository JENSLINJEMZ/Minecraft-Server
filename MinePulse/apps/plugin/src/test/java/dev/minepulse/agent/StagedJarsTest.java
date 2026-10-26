package dev.minepulse.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class StagedJarsTest {

    @Test
    void stagedDisableSurvivesReinitAndIsAppliedOnShutdown(@TempDir Path root) throws Exception {
        Path plugins = Files.createDirectories(root.resolve("plugins"));
        Path disabled = Files.createDirectories(root.resolve("plugins-disabled"));
        Path data = Files.createDirectories(root.resolve("data"));

        StagedJars.init(plugins, data);
        assertTrue(StagedJars.pendingDisables().isEmpty());

        Path jar = Files.writeString(plugins.resolve("headdrop-3.1.0.jar"), "jar");
        StagedJars.addPendingDisable("HeadDrop", "headdrop-3.1.0.jar");
        assertEquals(Set.of("headdrop"), StagedJars.pendingDisables());

        // The intent is stored on disk, so a restart keeps reporting it.
        StagedJars.init(plugins, data);
        assertTrue(StagedJars.hasPendingDisable("HeadDrop"));

        List<String> log = new ArrayList<>();
        StagedJars.applyPending(log::add);
        assertFalse(Files.exists(jar));
        assertTrue(Files.isRegularFile(disabled.resolve("headdrop-3.1.0.jar")));
        assertTrue(StagedJars.pendingDisables().isEmpty());
        assertEquals(1, log.size());

        StagedJars.init(plugins, data);
        assertTrue(StagedJars.pendingDisables().isEmpty());
    }

    @Test
    void clearingAPendingDisableDropsTheIntent(@TempDir Path root) throws Exception {
        Path plugins = Files.createDirectories(root.resolve("plugins"));
        Path data = Files.createDirectories(root.resolve("data"));

        StagedJars.init(plugins, data);
        StagedJars.addPendingDisable("HeadDrop", "headdrop-3.1.0.jar");
        StagedJars.clearPendingDisable("headdrop");

        StagedJars.init(plugins, data);
        assertTrue(StagedJars.pendingDisables().isEmpty());
    }
}
