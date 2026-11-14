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
            var tags = new ObjectMapper().readTree(first[i + 4].toString());
            assertEquals("source:notion", tags.get(0).asText());
            assertEquals("project:프로젝트", tags.get(1).asText());
            assertTrue(first[i + 4].toString().contains("track:기획·협업"));
            assertEquals("notion", first[i + 5]);
            assertTrue(first[i + 6].toString().endsWith(".md"));
            assertEquals(64, first[i + 8].toString().length());
        }
    }

    @Test void differentPagesPersistTheirOwnTracksWithoutInventingProjects() throws Exception {
        var entries = new LinkedHashMap<String,byte[]>();
        entries.put("rag.md", NotionZipReaderTest.text("# RAG\nEmbedding retrieval"));
        entries.put("ui.md", NotionZipReaderTest.text("# React\nCSS 화면"));
        when(db.update(anyString(), any(Object[].class))).thenReturn(2);
        service.importArchive("owner", NotionZipReaderTest.zip(entries), "");
        var arguments = ArgumentCaptor.forClass(Object[].class);
        verify(db).update(anyString(), arguments.capture());
        String allTags = arguments.getValue()[4] + " " + arguments.getValue()[13];
        assertTrue(allTags.contains("track:AI·RAG"));
        assertTrue(allTags.contains("track:프론트엔드·UI"));
        assertFalse(allTags.contains("project:"));
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
