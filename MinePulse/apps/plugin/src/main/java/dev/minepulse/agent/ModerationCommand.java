package dev.minepulse.agent;

/**
 * One queued action delivered by the API. The {@code action} is a fixed verb
 * from a closed set; the agent maps it onto a specific Paper API call. The
 * website can never inject an arbitrary console command.
 *
 * <p>{@code plugin} carries the installed plugin name for the plugin lifecycle
 * verbs ({@code plugin_enable}/{@code plugin_disable}/{@code plugin_reload}).
 * {@code cmd} carries the fixed console command id for the {@code console}
 * verb; the executor maps each id onto one exact console dispatch.
 * {@code item}/{@code amount} carry the give request for the {@code give} verb.
 */
public record ModerationCommand(
        String id,
        String action,
        String targetUuid,
        String targetName,
        String reason,
        String mode,
        String text,
        String plugin,
        String cmd,
        String item,
        Integer amount) {
}
