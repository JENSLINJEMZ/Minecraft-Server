package dev.minepulse.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EventBufferTest {

    private static Map<String, Object> event(String id) {
        return Map.of("id", id);
    }

    @Test
    void drainReturnsEventsOldestFirst() {
        EventBuffer buffer = new EventBuffer(10);
        buffer.add(event("a"));
        buffer.add(event("b"));
        buffer.add(event("c"));

        List<Map<String, Object>> drained = buffer.drain(10);

        assertEquals(List.of("a", "b", "c"),
                drained.stream().map(e -> (String) e.get("id")).toList());
        assertEquals(0, buffer.size());
    }

    @Test
    void drainHonoursMaxAndLeavesRemainderQueued() {
        EventBuffer buffer = new EventBuffer(10);
        for (int i = 0; i < 5; i++) {
            buffer.add(event("e" + i));
        }

        List<Map<String, Object>> first = buffer.drain(2);

        assertEquals(2, first.size());
        assertEquals(3, buffer.size());
    }

    @Test
    void dropsOldestEventsWhenFullAndCountsThem() {
        EventBuffer buffer = new EventBuffer(3);
        for (int i = 0; i < 5; i++) {
            buffer.add(event("e" + i));
        }

        assertEquals(3, buffer.size());
        assertEquals(2, buffer.droppedCount());

        List<Map<String, Object>> drained = buffer.drain(10);
        assertEquals(List.of("e2", "e3", "e4"),
                drained.stream().map(e -> (String) e.get("id")).toList());
    }

    @Test
    void emptyDrainIsEmpty() {
        EventBuffer buffer = new EventBuffer(3);
        assertTrue(buffer.drain(10).isEmpty());
        assertEquals(0, buffer.droppedCount());
    }
}
