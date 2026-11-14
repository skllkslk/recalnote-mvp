package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class RecordTracksTest {
    @Test void combinesTitleBodyAndPathAndAllowsMultipleTracks() {
        assertEquals(List.of("AI·RAG", "백엔드·API", "인증·보안"),
            RecordTracks.classify("RAG 구성", "Spring OAuth 구현", "notes/"));
        assertEquals(List.of("배포·인프라"), RecordTracks.classify("작업", "내용", "Docker/setup.md"));
    }

    @Test void avoidsSubstringMatchesAndKeepsUnknownTopicsUnclassified() {
        assertEquals(List.of("미분류"), RecordTracks.classify("fragment", "오늘의 일기", ""));
    }

    @Test void recomputesOnlyGeneratedTagsAndPreservesUserProjectMembership() {
        var tags = RecordTracks.withTags(List.of("source:notion", "project:내 프로젝트", "track:AI·RAG", "회고"), "React", "CSS", "");
        assertTrue(tags.containsAll(List.of("source:notion", "project:내 프로젝트", "회고", "track:프론트엔드·UI", "track-version:keywords-v1")));
        assertFalse(tags.contains("track:AI·RAG"));
    }
}
