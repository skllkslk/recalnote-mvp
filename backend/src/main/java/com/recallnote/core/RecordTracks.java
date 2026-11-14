package com.recallnote.core;

import java.util.*;
import java.util.regex.Pattern;

/** Versioned, deterministic topic suggestions; never project membership. */
final class RecordTracks {
    static final String VERSION = "keywords-v1";
    private record Rule(String name, Pattern keywords) {}
    private static Rule rule(String name, String keywords) {
        return new Rule(name, Pattern.compile(keywords, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE));
    }
    private static final List<Rule> RULES = List.of(
        rule("AI·RAG", "\\b(rag|llm|embedding|embeddings|langchain|openai|gemini|vector)\\b|임베딩|벡터|언어 모델|프롬프트|검색 증강"),
        rule("백엔드·API", "\\b(spring|fastapi|django|backend|express|rest|graphql)\\b|백엔드|서버 개발|API 설계"),
        rule("프론트엔드·UI", "\\b(react|next\\.?js|vue|frontend|css|tailwind|figma)\\b|프론트엔드|화면 설계|사용자 인터페이스"),
        rule("데이터·DB", "\\b(sql|postgresql|postgres|mysql|redis|database|etl)\\b|데이터베이스|데이터 분석|쿼리|인덱스"),
        rule("인증·보안", "\\b(oauth|oidc|csrf|xss|jwt|authentication|authorization)\\b|인증|인가|보안|접근 제어"),
        rule("배포·인프라", "\\b(docker|kubernetes|aws|railway|vercel|terraform|ci/cd)\\b|배포|인프라|모니터링"),
        rule("테스트·품질", "\\b(junit|pytest|unittest|playwright|testing|regression)\\b|테스트|회귀 검증|품질 평가"),
        rule("기획·협업", "\\b(scrum|agile|retrospective)\\b|요구사항|사용자 인터뷰|스프린트|협업|회고")
    );

    static List<String> classify(String title, String content, String path) {
        String text = title + "\n" + path + "\n" + content;
        List<String> matches = RULES.stream().filter(rule -> rule.keywords().matcher(text).find()).map(Rule::name).toList();
        return matches.isEmpty() ? List.of("미분류") : matches;
    }

    static List<String> withTags(List<String> tags, String title, String content, String path) {
        Set<String> result = new LinkedHashSet<>();
        tags.stream().filter(tag -> !tag.startsWith("track:") && !tag.startsWith("track-version:")).forEach(result::add);
        classify(title, content, path).forEach(track -> result.add("track:" + track));
        result.add("track-version:" + VERSION);
        return List.copyOf(result);
    }
}
