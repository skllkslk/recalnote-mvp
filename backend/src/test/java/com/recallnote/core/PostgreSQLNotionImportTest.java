package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.jdbc.core.JdbcTemplate;

/** Run only against a disposable test database, using the same opt-in as security integration tests. */
@EnabledIfEnvironmentVariable(named="TEST_DB_URL", matches=".+")
@SpringBootTest(properties={"spring.datasource.url=${TEST_DB_URL}", "spring.datasource.username=${TEST_DB_USER}",
    "spring.datasource.password=${TEST_DB_PASSWORD}", "spring.security.oauth2.client.registration.google.client-id=test-client",
    "spring.security.oauth2.client.registration.google.client-secret=test-secret", "app.public-base-url=https://example.com", "app.dev-user-enabled=false"})
class PostgreSQLNotionImportTest {
    @Autowired NotionImportService service;
    @SpyBean JdbcTemplate db;

    private String user() {
        String user = UUID.randomUUID().toString();
        db.update("INSERT INTO app_user(id) VALUES (?)", user);
        return user;
    }
    private int count(String user) { return db.queryForObject("SELECT count(*) FROM record WHERE user_id=?", Integer.class, user); }
    private void cleanup(String user) {
        db.update("DELETE FROM record WHERE user_id=?", user);
        db.update("DELETE FROM app_user WHERE id=?", user);
    }

    @Test void duplicateImportsArePerUserAndPreserveEditsWhileDeletedPagesCanBeImportedAgain() throws Exception {
        String a = user(), b = user();
        byte[] archive = NotionZipReaderTest.zip(Map.of(NotionZipReaderTest.PAGE, NotionZipReaderTest.text("# 회고\n본문")));
        try {
            assertEquals(1, service.importArchive(a, archive, "Project").imported());
            db.update("UPDATE record SET content_markdown='사용자 편집',version=2 WHERE user_id=?", a);
            assertEquals(1, service.importArchive(a, archive, "").duplicates());
            assertEquals("사용자 편집", db.queryForObject("SELECT content_markdown FROM record WHERE user_id=?", String.class, a));
            assertEquals(1, count(a));
            assertEquals(1, service.importArchive(b, archive, "").imported());
            assertEquals(1, count(b));
            assertEquals(NotionZipReaderTest.PAGE, db.queryForObject("SELECT source_path FROM record WHERE user_id=?", String.class, a));
            db.update("UPDATE record SET deleted_at=now() WHERE user_id=?", a);
            assertEquals(1, service.importArchive(a, archive, "").imported());
            assertEquals(2, count(a));
        } finally { cleanup(a); cleanup(b); }
    }

    @Test void laterBatchFailureRollsBackEarlierInserts() throws Exception {
        String user = user();
        var entries = new LinkedHashMap<String,byte[]>();
        for (int i = 0; i < 101; i++) entries.put("page-" + i + ".md", NotionZipReaderTest.text("# Page " + i));
        var calls = new AtomicInteger();
        doAnswer(invocation -> {
            if (calls.incrementAndGet() == 2) throw new org.springframework.dao.DataAccessResourceFailureException("simulated batch failure");
            return invocation.callRealMethod();
        }).when(db).update(startsWith("INSERT INTO record("), any(Object[].class));
        try {
            assertThrows(org.springframework.dao.DataAccessException.class, () -> service.importArchive(user, NotionZipReaderTest.zip(entries), ""));
            assertEquals(0, count(user), "The first batch must not remain after the second fails");
        } finally { cleanup(user); }
    }
}
