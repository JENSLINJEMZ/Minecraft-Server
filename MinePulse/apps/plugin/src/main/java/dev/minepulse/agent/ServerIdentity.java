package dev.minepulse.agent;

/** Server software identity reported in heartbeats. */
public record ServerIdentity(String minecraftVersion, String paperVersion) {
}
