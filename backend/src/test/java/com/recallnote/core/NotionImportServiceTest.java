package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

class NotionImportServiceTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final NotionImportService service = new NotionImportService(db, new ObjectMapper());

    @Test void batchesPagesAndReportsActualInsertCountWithAuthenticatedOwnerAndProvenance() throws Exception {
        var entries = new LinkedHashMap<String,byte[]>();
        for (int i = 0; i < 102; i++) entries.put("page-" + i + ".md", NotionZipReaderTest.text("# 회고 " + i));
        when(db.update(anyString(), any(Object[].class))).thenReturn(99, 1);
        var result = service.importArchive("owner-a", NotionZipReaderTest.zip(entries), "  프로젝트  ");
        assertEquals(102, result.totalPages());
        assertEquals(100, result.imported());
        assertEquals(2, result.duplicates());
        var arguments = ArgumentCaptor.forClass(Object[].class);
        verify(db, times(2)).update(contains("ON CONFLICT (user_id,import_key) WHERE deleted_at IS NULL DO NOTHING"), arguments.capture());
        Object[] first = arguments.getAllValues().get(0);
        assertEquals(900, first.length);
        assertEquals(18, arguments.getAllValues().get(1).length);
        for (int i = 0; i < first.length; i += 9) {
            assertEquals("owner-a", first[i + 1]);
            assertEquals("[\"source:notion\",\"project:프로젝트\"]", first[i + 4]);
            assertEquals("notion", first[i + 5]);
            assertTrue(first[i + 6].toString().endsWith(".md"));
            assertEquals(64, first[i + 8].toString().length());
        }
    }

    @Test void validatesWholeArchiveBeforeWritingAnyPage() throws Exception {
        var entries = new LinkedHashMap<String,byte[]>();
        entries.put("valid.md", NotionZipReaderTest.text("# Good"));
        entries.put("../unsafe.md", NotionZipReaderTest.text("# Bad"));
        assertThrows(IllegalArgumentException.class, () -> service.importArchive("owner-a", NotionZipReaderTest.zip(entries), ""));
        assertThrows(IllegalArgumentException.class, () -> service.importArchive(null, new byte[0], ""));
        assertThrows(IllegalArgumentException.class, () -> service.importArchive("owner-a", new byte[0], "x".repeat(101)));
        verifyNoInteractions(db);
    }

    @Test void persistenceFailuresAreNotReportedAsSuccessfulImports() throws Exception {
        when(db.update(anyString(), any(Object[].class))).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("unavailable"));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> service.importArchive("owner-a",
                NotionZipReaderTest.zip(Map.of("page.md", NotionZipReaderTest.text("# Page"))), ""));
    }
}
