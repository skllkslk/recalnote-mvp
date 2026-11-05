package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class ApprovalFlowTest {
    private final JdbcTemplate db=mock(JdbcTemplate.class);
    private final ApiController api=new ApiController(db,"http://localhost:1","key","unused");
    private final UUID id=UUID.randomUUID();

    @BeforeEach void user() { ApiController.CURRENT_USER.set("test-user"); }
    @AfterEach void clear() { ApiController.CURRENT_USER.remove(); }

    private void proposal(int staleCount) {
        Map<String,Object> p=new HashMap<>(Map.of("status","PENDING","title","제목","description","목표","steps_json","[\"단계 1\",\"단계 2\"]","completion_criteria","검증","result_markdown","# 원본 초안","epic_id",UUID.randomUUID()));
        when(db.queryForMap(contains("FROM quest_proposal"),eq(id),eq("test-user"))).thenReturn(p);
        when(db.queryForObject(contains("SELECT count(*)"),eq(Integer.class),eq(id))).thenReturn(staleCount);
    }

    @Test void editedResultIsStoredInQuest() {
        proposal(0);
        Map<String,Object> result=api.decision(id,Map.of("action","ACCEPT_EDITED","editedResultMarkdown","# 사용자가 편집한 결과"));
        assertEquals("ACCEPTED",result.get("status"));
        verify(db).update(startsWith("INSERT INTO quest("),any(UUID.class),eq("test-user"),any(UUID.class),eq(id),eq("제목"),eq("목표"),eq("[\"단계 1\",\"단계 2\"]"),eq("검증"),eq("# 사용자가 편집한 결과"));
        verify(db).update(startsWith("INSERT INTO quest_event"),any(UUID.class));
    }

    @Test void staleEvidencePreventsApproval() {
        proposal(1);
        ResponseStatusException error=assertThrows(ResponseStatusException.class,()->api.decision(id,Map.of("action","ACCEPT")));
        assertEquals(409,error.getStatusCode().value());
        verify(db,never()).update(startsWith("INSERT INTO quest("),any(Object[].class));
    }

    @Test void emptyEditedResultIsRejected() {
        proposal(0);
        ResponseStatusException error=assertThrows(ResponseStatusException.class,()->api.decision(id,Map.of("action","ACCEPT_EDITED","editedResultMarkdown"," ")));
        assertEquals(400,error.getStatusCode().value());
    }

    @Test void approvedSessionCannotReceiveMoreTurns() {
        when(db.queryForList(contains("FOR UPDATE"),eq(id),eq("test-user"))).thenReturn(List.of(Map.of("id",id)));
        when(db.queryForMap(contains("FROM agent_session"),eq(id),eq("test-user"))).thenReturn(new HashMap<>(Map.of("state","APPROVED","cards","[]")));
        ResponseStatusException error=assertThrows(ResponseStatusException.class,()->api.agentTurn(id,Map.of("cardId","role","value","debug")));
        assertEquals(409,error.getStatusCode().value());
        verifyNoMoreInteractionsAfterRead();
    }

    private void verifyNoMoreInteractionsAfterRead() { verify(db,never()).update(anyString(),any(Object[].class)); }
}
