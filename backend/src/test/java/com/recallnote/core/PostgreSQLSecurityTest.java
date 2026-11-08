package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;

@EnabledIfEnvironmentVariable(named="TEST_DB_URL", matches=".+")
@SpringBootTest(properties={"spring.datasource.url=${TEST_DB_URL}", "spring.datasource.username=${TEST_DB_USER}",
    "spring.datasource.password=${TEST_DB_PASSWORD}", "spring.security.oauth2.client.registration.google.client-id=test-client", "spring.security.oauth2.client.registration.google.client-secret=test-secret", "app.public-base-url=https://example.com", "app.dev-user-enabled=false"})
@AutoConfigureMockMvc
class PostgreSQLSecurityTest {
    @Autowired MockMvc mvc;
    @Autowired SocialIdentityService identities;
    @Autowired JdbcTemplate db;
    @Autowired @SuppressWarnings("rawtypes") org.springframework.session.SessionRepository sessions;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper json;

    @Test void identitiesAndRecordOwnership() throws Exception {
        String subject=UUID.randomUUID().toString();
        String a=identities.resolve(subject), b=identities.resolve(UUID.randomUUID().toString());
        assertEquals(a,identities.resolve(subject)); assertNotEquals(a,b);
        try {
            String response=mvc.perform(post("/api/v1/records").with(oidcLogin().oidcUser(SecurityTest.user(a))).with(csrf())
                .contentType("application/json").content("{\"title\":\"private\",\"contentMarkdown\":\"private source\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
            String id=json.readTree(response).get("id").asText();
            mvc.perform(get("/api/v1/records/"+id).with(oidcLogin().oidcUser(SecurityTest.user(b)))).andExpect(status().isNotFound());
            mvc.perform(put("/api/v1/records/"+id).with(oidcLogin().oidcUser(SecurityTest.user(b))).with(csrf())
                .contentType("application/json").content("{\"title\":\"attack\",\"contentMarkdown\":\"attack\"}"))
                .andExpect(status().isNotFound());
            mvc.perform(delete("/api/v1/records/"+id).with(oidcLogin().oidcUser(SecurityTest.user(b))).with(csrf())).andExpect(status().isNotFound());
            mvc.perform(get("/api/v1/records").with(oidcLogin().oidcUser(SecurityTest.user(b)))).andExpect(content().json("[]"));
        } finally {
            db.update("DELETE FROM record WHERE user_id IN (?,?)",a,b);
            db.update("DELETE FROM social_identity WHERE user_id IN (?,?)",a,b);
            db.update("DELETE FROM app_user WHERE id IN (?,?)",a,b);
        }
    }
    @Test void sessionSecurityContextSurvivesDatabaseRoundTrip() {
        var session=sessions.createSession();
        var principal=SecurityTest.user("session-user");
        session.setAttribute("SPRING_SECURITY_CONTEXT",new SecurityContextImpl(
            new OAuth2AuthenticationToken(principal,principal.getAuthorities(),"google")));
        sessions.save(session);
        try {
            var restored=sessions.findById(session.getId());
            assertNotNull(restored);
            SecurityContextImpl context=restored.getAttribute("SPRING_SECURITY_CONTEXT");
            assertEquals("session-user",context.getAuthentication().getName());
        } finally { sessions.deleteById(session.getId()); }
        assertNull(sessions.findById(session.getId()));
    }
}
