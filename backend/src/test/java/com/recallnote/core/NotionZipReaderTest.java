package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;

class NotionZipReaderTest {
    static final String PAGE = "경험/회고 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md";
    static byte[] zip(Map<String,byte[]> entries) throws Exception {
        var output = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(output)) {
            for (var entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue());
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }
    static byte[] text(String value) { return value.getBytes(StandardCharsets.UTF_8); }

    @Test void preservesKoreanContentPropertiesAndSourceWhileSkippingIndexesAndAttachments() throws Exception {
        var entries = new LinkedHashMap<String,byte[]>();
        entries.put(PAGE, text("\uFEFF# 업무 회고\r\n\r\nStatus: 완료\r\n\r\n![첨부](image.png)\r\n"));
        entries.put("목록.csv", text("이름,상태\n업무 회고,완료"));
        entries.put("목록_all.csv", text("이름,상태"));
        entries.put("image.png", new byte[]{1,2,3});
        entries.put("empty.md", text(" \n\t"));
        var archive = NotionZipReader.read(zip(entries));
        assertEquals(1, archive.pages().size());
        assertEquals(2, archive.csvFiles());
        assertEquals(1, archive.attachmentFiles());
        assertEquals(1, archive.emptyPages());
        var page = archive.pages().get(0);
        assertEquals("업무 회고", page.title());
        assertEquals("# 업무 회고\n\nStatus: 완료\n\n![첨부](image.png)\n", page.content());
        assertEquals(PAGE, page.path());
        assertEquals("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", page.pageId());
    }

    @Test void duplicateKeySurvivesRepackagingButDetectsChangedTextAndDistinctPages() throws Exception {
        var first = NotionZipReader.read(zip(Map.of(PAGE, text("# 회고\r\n본문")))).pages().get(0);
        var repacked = NotionZipReader.read(zip(Map.of("새 폴더/새 이름 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", text("# 회고\n본문")))).pages().get(0);
        var changed = NotionZipReader.read(zip(Map.of(PAGE, text("# 회고\n변경된 본문")))).pages().get(0);
        var other = NotionZipReader.read(zip(Map.of("회고 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md", text("# 회고\n본문")))).pages().get(0);
        assertEquals(first.importKey(), repacked.importKey());
        assertNotEquals(first.importKey(), changed.importKey());
        assertNotEquals(first.importKey(), other.importKey());
    }

    @Test void nestedExportsAndFilenameTitleFallback() throws Exception {
        var nested = zip(Map.of("자료/제목 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", text("본문만 있습니다.")));
        var page = NotionZipReader.read(zip(Map.of("Export/Part-1.zip", nested))).pages().get(0);
        assertEquals("제목", page.title());
        assertEquals("Export/Part-1.zip!/자료/제목 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", page.path());
    }

    @Test void rejectsTraversalCorruptArchivesInvalidEncodingAndEmptyExports() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(Map.of("../outside.md", text("# unsafe")))));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(text("not a zip")));
        byte[] archive = zip(Map.of(PAGE, text("# 정상")));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(Arrays.copyOf(archive, archive.length - 15)));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(Map.of(PAGE, new byte[]{(byte)0xff}))));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(Map.of("list.csv", text("name")))));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(Map.of(PAGE, text("nul\0byte")))));
    }

    @Test void limitsUploadPageSizeAndExpansionIncludingSkippedAttachments() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(new byte[NotionZipReader.MAX_UPLOAD_BYTES + 1]));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(Map.of(PAGE, new byte[1024 * 1024 + 1]))));
        var entries = new LinkedHashMap<String,byte[]>();
        entries.put(PAGE, text("# Page"));
        entries.put("large.bin", new byte[25 * 1024 * 1024]);
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(entries)));
        entries.remove("large.bin");
        entries.put("directory-with-hidden-data/", new byte[25 * 1024 * 1024]);
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(entries)));
    }

    @Test void rejectsExcessiveNestingAndPageCount() throws Exception {
        byte[] nested = zip(Map.of(PAGE, text("# Page")));
        for (int i = 0; i < 3; i++) nested = zip(Map.of("nested.zip", nested));
        byte[] tooDeep = nested;
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(tooDeep));
        var entries = new LinkedHashMap<String,byte[]>();
        for (int i = 0; i < 2001; i++) entries.put("page-" + i + ".md", text("# Page"));
        assertThrows(IllegalArgumentException.class, () -> NotionZipReader.read(zip(entries)));
    }

    @Test void suppliedLocalNotionExportContains672ReadablePagesAnd10CsvIndexes() throws Exception {
        // The user's private example is deliberately not a committed test fixture.
        Path sample = Path.of("../tests/notion_data_ex.zip");
        Assumptions.assumeTrue(Files.exists(sample), "Private local sample not present");
        var archive = NotionZipReader.read(Files.readAllBytes(sample));
        assertEquals(672, archive.pages().size());
        assertEquals(10, archive.csvFiles());
        assertEquals(0, archive.emptyPages());
        assertEquals(0, archive.attachmentFiles());
        assertTrue(archive.pages().stream().allMatch(page -> !page.title().isBlank() && !page.content().isBlank()));
        assertTrue(archive.pages().stream().anyMatch(page -> page.title().codePoints().anyMatch(c -> c >= 0xac00 && c <= 0xd7a3)));
        System.out.println("Notion local sample verified: " + archive.pages().size() + " pages, " + archive.csvFiles() + " CSV indexes");
    }
}
