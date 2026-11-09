package com.recallnote.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotionImportService {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    public NotionImportService(JdbcTemplate db, ObjectMapper json) { this.db = db; this.json = json; }

    public record Result(int totalPages, int imported, int duplicates, int csvFiles, int attachmentFiles, int emptyPages) {}

    @Transactional
    public Result importArchive(String userId, byte[] bytes, String project) {
        if (userId == null || userId.isBlank()) throw new IllegalArgumentException("로그인이 필요합니다.");
        if (project.length() > 100) throw new IllegalArgumentException("프로젝트 이름은 100자 이하로 입력해 주세요.");
        var archive = NotionZipReader.read(bytes);
        String tags;
        try { tags = json.writeValueAsString(project.isBlank() ? List.of("source:notion") : List.of("source:notion", "project:" + project.strip())); }
        catch (JsonProcessingException error) { throw new IllegalStateException(error); }
        int imported = 0;
        // Batch INSERTs keep hundreds of pages within the deployment's request duration.
        for (int offset = 0; offset < archive.pages().size(); offset += 100) {
            var batch = archive.pages().subList(offset, Math.min(offset + 100, archive.pages().size()));
            var args = new ArrayList<Object>();
            for (var page : batch) Collections.addAll(args, UUID.randomUUID(), userId, page.title(), page.content(), tags,
                    "notion", page.path(), page.pageId(), page.importKey());
            imported += db.update("INSERT INTO record(id,user_id,title,content_markdown,tags_json,source_type,source_path,source_page_id,import_key) VALUES "
                    + String.join(",", Collections.nCopies(batch.size(), "(?,?,?,?,?::jsonb,?,?,?,?)"))
                    + " ON CONFLICT (user_id,import_key) WHERE deleted_at IS NULL DO NOTHING", args.toArray());
        }
        return new Result(archive.pages().size(), imported, archive.pages().size() - imported,
                archive.csvFiles(), archive.attachmentFiles(), archive.emptyPages());
    }
}
