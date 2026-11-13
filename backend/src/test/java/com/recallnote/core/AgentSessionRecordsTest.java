package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class AgentSessionRecordsTest {
    private final JdbcTemplate db=mock(JdbcTemplate.class);
    @BeforeEach void user() { ApiController.CURRENT_USER.set("owner"); }
    @AfterEach void clear() { ApiController.CURRENT_USER.remove(); }

    @Test void selectedOriginalRecordsReachAgentWithoutCreatingDuplicateRecord() throws Exception {
        UUID id=UUID.randomUUID();
        var received=new AtomicReference<String>();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/internal/v1/agent-sessions/interpret",exchange -> {
            received.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
            byte[] response="{\"state\":\"NEEDS_INPUT\",\"cards\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            when(db.queryForMap(contains("FROM record WHERE"),eq(id),eq("owner")))
                .thenReturn(Map.of("id",id,"title","Imported page","contentMarkdown","Original text","version",3));
            when(db.queryForList(contains("FROM epic WHERE"),eq("owner"),eq("CAREER")))
                .thenReturn(List.of(Map.of("id",UUID.randomUUID(),"title","Career")));
            when(db.queryForMap(contains("FROM agent_session"),any(UUID.class),eq("owner")))
                .thenReturn(new HashMap<>(Map.of("id",UUID.randomUUID(),"useCase","CAREER","state","NEEDS_INPUT","cards","[]")));
            var api=new ApiController(db,"http://127.0.0.1:"+server.getAddress().getPort(),"key","unused");
            api.createAgentSession(Map.of("useCase","CAREER","recordIds",List.of(id.toString(),id.toString())));
            var payload=new ObjectMapper().readTree(received.get());
            assertEquals(1,payload.get("records").size());
            assertEquals(id.toString(),payload.get("records").get(0).get("id").asText());
            assertEquals("Original text",payload.get("records").get(0).get("contentMarkdown").asText());
            verify(db,never()).update(startsWith("INSERT INTO record("),any(Object[].class));
        } finally { server.stop(0); }
    }

    @Test void missingOrUnownedRecordIsRejectedBeforeAnyWrite() {
        UUID id=UUID.randomUUID();
        when(db.queryForMap(contains("FROM record WHERE"),eq(id),eq("owner")))
            .thenThrow(new EmptyResultDataAccessException(1));
        var api=new ApiController(db,"http://localhost:1","key","unused");
        assertThrows(ApiController.NotFoundException.class,()->api.createAgentSession(Map.of("recordIds",List.of(id.toString()))));
        verify(db,never()).update(anyString(),any(Object[].class));
    }

    @Test void emptyInputAndOversizedSelectionAreRejected() {
        var api=new ApiController(db,"http://localhost:1","key","unused");
        assertEquals(400,assertThrows(ResponseStatusException.class,()->api.createAgentSession(Map.of())).getStatusCode().value());
        assertEquals(400,assertThrows(ResponseStatusException.class,()->api.createAgentSession(Map.of("recordIds",Collections.nCopies(21,UUID.randomUUID().toString())))).getStatusCode().value());
        verifyNoInteractions(db);
    }
}
