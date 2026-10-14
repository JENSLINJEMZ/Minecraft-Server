package dev.minepulse.agent;

/**
 * One queued moderation action delivered by the API. The {@code action} is a
 * fixed verb from a closed set; the agent maps it onto a specific Paper API
 * call. The website can never inject an arbitrary console command.
 */
public record ModerationCommand(
        String id,
        String action,
        String targetUuid,
        String targetName,
        String reason,
        String mode,
        String text) {
}
