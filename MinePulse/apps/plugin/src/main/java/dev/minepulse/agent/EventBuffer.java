package dev.minepulse.agent;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Thread-safe, bounded FIFO of structured events waiting to be flushed.
 * When full, the oldest events are dropped so a long API outage cannot grow
 * memory without bound.
 */
public final class EventBuffer {

    private final int capacity;
    private final Deque<Map<String, Object>> queue = new ArrayDeque<>();
    private final AtomicLong dropped = new AtomicLong(0L);

    public EventBuffer(int capacity) {
        this.capacity = Math.max(1, capacity);
    }

    public synchronized void add(Map<String, Object> event) {
        if (queue.size() >= capacity) {
            queue.pollFirst();
            dropped.incrementAndGet();
        }
        queue.addLast(event);
    }

    /** Remove and return up to {@code max} events (oldest first). */
    public synchronized List<Map<String, Object>> drain(int max) {
        List<Map<String, Object>> out = new ArrayList<>();
        while (!queue.isEmpty() && out.size() < max) {
            out.add(queue.pollFirst());
        }
        return out;
    }

    public synchronized int size() {
        return queue.size();
    }

    public long droppedCount() {
        return dropped.get();
    }
}
