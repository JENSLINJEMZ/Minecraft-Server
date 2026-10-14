package dev.minepulse.agent;

import java.net.NetworkInterface;
import java.util.List;
import oshi.SystemInfo;
import oshi.hardware.HardwareAbstractionLayer;
import oshi.hardware.NetworkIF;

/**
 * Reads host-wide network byte counters via OSHI. OSHI is loaded by Paper from
 * the {@code libraries} declared in plugin.yml, so this class is deliberately
 * isolated: if the library is unavailable the caller catches the linkage error
 * and the dashboard honestly reports "not available". All counters are
 * cumulative (bytes since boot); the API/dashboard difference them into rates.
 */
final class NetworkSampler {

    private NetworkSampler() {
    }

    /** Cumulative bytes received/sent across every non-loopback interface. */
    record Counters(long rxBytes, long txBytes) {
    }

    static Counters sample() {
        HardwareAbstractionLayer hal = new SystemInfo().getHardware();
        List<NetworkIF> interfaces = hal.getNetworkIFs();
        long rx = 0L;
        long tx = 0L;
        boolean found = false;
        for (NetworkIF nic : interfaces) {
            try {
                nic.updateAttributes();
            } catch (Throwable ignored) {
                // Fall back to whatever counters this interface already exposes.
            }
            if (isLoopback(nic)) {
                continue;
            }
            long received = nic.getBytesRecv();
            long sent = nic.getBytesSent();
            if (received < 0L || sent < 0L) {
                continue;
            }
            rx += received;
            tx += sent;
            found = true;
        }
        return found ? new Counters(rx, tx) : null;
    }

    private static boolean isLoopback(NetworkIF nic) {
        try {
            NetworkInterface javaNic = nic.queryNetworkInterface();
            return javaNic != null && javaNic.isLoopback();
        } catch (Throwable ignored) {
            return false;
        }
    }
}
