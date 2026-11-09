package com.recallnote.core;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers={ApiController.class, AuthController.class, NotionImportController.class}, properties={
    "spring.security.oauth2.client.registration.google.client-id=test-client", "spring.security.oauth2.client.registration.google.client-secret=test-secret", "app.public-base-url=https://example.com", "app.dev-user-enabled=false"})
@Import(SecurityConfig.class)
class SecurityTest {
    @Autowired MockMvc mvc;
    @MockBean JdbcTemplate db;
    @MockBean SocialIdentityService identities;
    @MockBean NotionImportService notionImports;

    static org.springframework.security.oauth2.core.oidc.user.OidcUser user(String id) {
        return new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")),
            new OidcIdToken("test", java.time.Instant.now(), java.time.Instant.now().plusSeconds(600),
                Map.of("sub", "google-sub-"+id, "app_user_id", id)), "app_user_id");
    }
    @Test void anonymousAndForgedHeadersAreRejected() throws Exception {
        mvc.perform(get("/api/v1/records").header("X-Authenticated-User","victim")).andExpect(status().isUnauthorized());
        verifyNoInteractions(db);
    }
    @Test void notionImportRequiresSessionAndCsrf() throws Exception {
        var file = new org.springframework.mock.web.MockMultipartFile("file", "notion.zip", "application/zip", new byte[]{1});
        mvc.perform(multipart("/api/v1/imports/notion").file(file).with(csrf()))
            .andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/v1/imports/notion").file(file).with(oidcLogin().oidcUser(user("member-a"))))
            .andExpect(status().isForbidden());
        verifyNoInteractions(notionImports);
    }
    @Test void notionImportUsesSessionOwnerAndReturnsSummary() throws Exception {
        byte[] bytes = NotionZipReaderTest.zip(Map.of("page.md", NotionZipReaderTest.text("# Page")));
        var file = new org.springframework.mock.web.MockMultipartFile("file", "notion.zip", "application/zip", bytes);
        when(notionImports.importArchive(eq("member-a"), any(byte[].class), eq("Project")))
            .thenReturn(new NotionImportService.Result(1,1,0,0,0,0));
        mvc.perform(multipart("/api/v1/imports/notion").file(file).param("project", "Project")
            .header("X-Authenticated-User", "member-b").with(oidcLogin().oidcUser(user("member-a"))).with(csrf()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.imported").value(1));
        verify(notionImports).importArchive(eq("member-a"), eq(bytes), eq("Project"));
    }
    @Test void invalidNotionUploadsReturnReadableErrors() throws Exception {
        var file = new org.springframework.mock.web.MockMultipartFile("file", "export.html", "text/html", new byte[]{1});
        mvc.perform(multipart("/api/v1/imports/notion").file(file).with(oidcLogin().oidcUser(user("member-a"))).with(csrf()))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").isNotEmpty());
        var large = new org.springframework.mock.web.MockMultipartFile("file", "export.zip", "application/zip", new byte[NotionZipReader.MAX_UPLOAD_BYTES + 1]);
        mvc.perform(multipart("/api/v1/imports/notion").file(large).with(oidcLogin().oidcUser(user("member-a"))).with(csrf()))
            .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.message").isNotEmpty());
        verifyNoInteractions(notionImports);
    }
    @Test void identityComesFromAuthenticatedPrincipal() throws Exception {
        mvc.perform(get("/api/v1/users/me").with(oidcLogin().oidcUser(user("member-a")))
            .header("X-Authenticated-User","member-b")).andExpect(status().isOk()).andExpect(jsonPath("$.id").value("member-a"));
        org.junit.jupiter.api.Assertions.assertNull(ApiController.CURRENT_USER.get());
    }
    @Test void csrfProtectsMutations() throws Exception {
        mvc.perform(post("/api/v1/records").with(oidcLogin().oidcUser(user("member-a")))
            .contentType("application/json").content("{}" )).andExpect(status().isForbidden());
        verifyNoInteractions(db);
    }
    @Test void recordQueriesUseEachAuthenticatedOwner() throws Exception {
        mvc.perform(get("/api/v1/records").with(oidcLogin().oidcUser(user("member-a")))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/records").with(oidcLogin().oidcUser(user("member-b")))).andExpect(status().isOk());
        verify(db).queryForList(contains("WHERE user_id=?"), eq("member-a"));
        verify(db).queryForList(contains("WHERE user_id=?"), eq("member-b"));
    }
    @Test void csrfEndpointAndHealthArePublic() throws Exception {
        mvc.perform(get("/auth/csrf")).andExpect(status().isOk()).andExpect(jsonPath("$.token").isNotEmpty());
    }
    @Test void logoutRequiresCsrfAndInvalidatesSession() throws Exception {
        var session = new org.springframework.mock.web.MockHttpSession();
        mvc.perform(post("/auth/logout").session(session).with(oidcLogin().oidcUser(user("member-a"))))
            .andExpect(status().isForbidden());
        mvc.perform(post("/auth/logout").session(session).with(oidcLogin().oidcUser(user("member-a"))).with(csrf()))
            .andExpect(status().isNoContent());
        org.junit.jupiter.api.Assertions.assertTrue(session.isInvalid());
    }
    @Test void loginUsesFixedPublicCallback() throws Exception {
        mvc.perform(get("/oauth2/authorization/google").header("Host","attacker.example"))
            .andExpect(status().is3xxRedirection())
            .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("redirect_uri=https://example.com/auth/callback/google")));
    }
    @Autowired org.springframework.security.oauth2.client.registration.ClientRegistrationRepository registrations;
    @Test void googleIssuerAndAudienceConfigurationAreFixed() {
        var google=registrations.findByRegistrationId("google");
        org.junit.jupiter.api.Assertions.assertEquals("https://accounts.google.com",google.getProviderDetails().getIssuerUri());
        org.junit.jupiter.api.Assertions.assertEquals("https://example.com/auth/callback/google",google.getRedirectUri());
    }
    @Test void callbackWithoutMatchingStateFailsClosed() throws Exception {
        mvc.perform(get("/login/oauth2/code/google").param("code","forged-code").param("state","forged-state"))
            .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("https://example.com/?login=failed"));
        verifyNoInteractions(identities,db);
    }

    @Test void otherMembersSessionAndProposalCannotBeReadOrApproved() throws Exception {
        var id=UUID.randomUUID();
        when(db.queryForMap(anyString(),eq(id),eq("member-b")))
            .thenThrow(new org.springframework.dao.EmptyResultDataAccessException(1));
        for (String path : List.of("/agent-sessions/", "/quest-proposals/")) {
            mvc.perform(get("/api/v1"+path+id).with(oidcLogin().oidcUser(user("member-b"))))
                .andExpect(status().isNotFound());
        }
        for (String suffix : List.of("/approve", "/reject", "/turns")) {
            mvc.perform(post("/api/v1/agent-sessions/"+id+suffix)
                .with(oidcLogin().oidcUser(user("member-b"))).with(csrf())
                .contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        }
        mvc.perform(post("/api/v1/quest-proposals/"+id+"/decisions")
            .with(oidcLogin().oidcUser(user("member-b"))).with(csrf())
            .contentType("application/json").content("{\"action\":\"ACCEPT\"}"))
            .andExpect(status().isNotFound());
        verify(db,never()).update(startsWith("INSERT INTO quest("),any(Object[].class));
    }

}
