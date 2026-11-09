package com.recallnote.core;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Reads Notion Markdown exports in memory; archive paths are never extracted to disk. */
final class NotionZipReader {
    static final int MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
    private static final int MAX_PAGE_BYTES = 1024 * 1024;
    private static final long MAX_EXPANDED_BYTES = 25L * 1024 * 1024;
    private static final int MAX_ENTRIES = 5000;
    private static final int MAX_PAGES = 2000;
    private static final Pattern PAGE_ID = Pattern.compile("(?i) ([0-9a-f]{32})\\.md$");
    private static final Pattern HEADING = Pattern.compile("(?m)^# +(.+?)\\s*$");

    record Page(String title, String content, String path, String pageId, String importKey) {}
    record Archive(List<Page> pages, int csvFiles, int attachmentFiles, int emptyPages) {}
    private final List<Page> pages = new ArrayList<>();
    private int entries, csvFiles, attachmentFiles, emptyPages;
    private long expandedBytes;

    static Archive read(byte[] bytes) {
        if (bytes.length > MAX_UPLOAD_BYTES) throw invalid("ZIP 파일은 4 MiB 이하로 선택해 주세요.");
        var reader = new NotionZipReader();
        reader.archive(bytes, "", 0);
        if (reader.pages.isEmpty()) throw invalid("가져올 Markdown 페이지가 없습니다. Notion에서 Markdown & CSV 형식으로 내보내 주세요.");
        return new Archive(List.copyOf(reader.pages), reader.csvFiles, reader.attachmentFiles, reader.emptyPages);
    }

    private void archive(byte[] bytes, String prefix, int depth) {
        if (depth > 2) throw invalid("중첩 ZIP은 2단계까지만 지원합니다.");
        // ZipInputStream alone accepts an archive with a missing central directory.
        requireCompleteZip(bytes);
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes), Charset.forName("IBM437"))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ENTRIES) throw invalid("ZIP 항목은 5,000개까지 가져올 수 있습니다.");
                String path = safePath(entry.getName());
                String lower = path.toLowerCase(Locale.ROOT);
                boolean metadata = path.startsWith("__MACOSX/") || path.substring(path.lastIndexOf('/') + 1).startsWith(".");
                boolean markdown = !entry.isDirectory() && !metadata && lower.endsWith(".md");
                boolean nested = !entry.isDirectory() && !metadata && lower.endsWith(".zip");
                var output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int length, size = 0;
                while ((length = zip.read(buffer)) != -1) {
                    expandedBytes += length;
                    size += length;
                    if (expandedBytes > MAX_EXPANDED_BYTES) throw invalid("압축 해제한 데이터는 총 25 MiB까지 가져올 수 있습니다.");
                    if (markdown && size > MAX_PAGE_BYTES) throw invalid("Markdown 페이지 하나의 크기는 1 MiB 이하여야 합니다.");
                    if (nested && size > MAX_UPLOAD_BYTES) throw invalid("중첩 ZIP 파일은 4 MiB 이하여야 합니다.");
                    if (markdown || nested) output.write(buffer, 0, length);
                }
                if (entry.isDirectory()) continue;
                if (nested) archive(output.toByteArray(), prefix + path + "!/", depth + 1);
                else if (markdown) page(prefix + path, output.toByteArray());
                else if (!metadata && lower.endsWith(".csv")) csvFiles++;
                else attachmentFiles++;
            }
        } catch (IOException | IllegalArgumentException error) {
            if (error instanceof IllegalArgumentException argument) throw argument;
            throw invalid("ZIP을 읽을 수 없습니다. 파일이 손상됐거나 지원하지 않는 압축 형식입니다.");
        }
    }

    private void page(String path, byte[] bytes) {
        String content;
        try {
            content = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException error) {
            throw invalid("Markdown은 UTF-8 인코딩이어야 합니다.");
        }
        if (content.startsWith("\uFEFF")) content = content.substring(1);
        content = content.replace("\r\n", "\n").replace('\r', '\n');
        if (content.isBlank()) { emptyPages++; return; }
        if (content.indexOf('\0') >= 0) throw invalid("Markdown에 저장할 수 없는 문자가 포함되어 있습니다.");
        if (pages.size() >= MAX_PAGES) throw invalid("Markdown 페이지는 한 번에 2,000개까지 가져올 수 있습니다.");
        String filename = path.substring(path.lastIndexOf('/') + 1);
        var id = PAGE_ID.matcher(filename);
        String pageId = id.find() ? id.group(1).toLowerCase(Locale.ROOT) : null;
        String title = pageId == null ? filename.replaceFirst("(?i)\\.md$", "") : filename.substring(0, id.start());
        var heading = HEADING.matcher(content);
        if (heading.find()) title = heading.group(1).strip();
        if (title.isBlank()) title = "제목 없음";
        // Same page + unchanged text is idempotent; changed text becomes a new record, preserving edits.
        String identity = pageId == null ? path : pageId;
        pages.add(new Page(title, content, path, pageId, sha256(identity + "\0" + content)));
    }

    private static String safePath(String raw) {
        String path = raw.replace('\\', '/');
        if (path.length() > 4096 || path.indexOf('\0') >= 0 || path.startsWith("/") || path.matches("^[A-Za-z]:.*"))
            throw invalid("ZIP에 올바르지 않은 파일 경로가 있습니다.");
        for (String part : path.split("/")) if (part.equals("..")) throw invalid("ZIP에 상위 폴더를 참조하는 경로가 있습니다.");
        return path;
    }

    private static void requireCompleteZip(byte[] bytes) {
        for (int i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (bytes[i] == 0x50 && bytes[i + 1] == 0x4b && bytes[i + 2] == 5 && bytes[i + 3] == 6) {
                int commentLength = (bytes[i + 20] & 255) | ((bytes[i + 21] & 255) << 8);
                if (i + 22 + commentLength == bytes.length) return;
            }
        }
        throw invalid("정상적인 ZIP 파일이 아닙니다. Notion에서 내보낸 ZIP을 선택해 주세요.");
    }

    private static String sha256(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
