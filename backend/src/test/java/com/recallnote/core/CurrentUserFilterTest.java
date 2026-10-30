package com.recallnote.core;

import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.assertEquals;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class CurrentUserFilterTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final FilterChain chain = mock(FilterChain.class);

    @Test
    void readinessDoesNotRequireAuthenticationWhenDevUserDisabled() throws Exception {
        CurrentUserFilter filter = new CurrentUserFilter(false, "dev-user-001", db);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/actuator/health/readiness");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertEquals(200, response.getStatus());
        verify(chain).doFilter(request, response);
        verifyNoInteractions(db);
    }

    @Test
    void apiRequestStillRequiresAuthenticationWhenDevUserDisabled() throws Exception {
        CurrentUserFilter filter = new CurrentUserFilter(false, "dev-user-001", db);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/records");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertEquals(401, response.getStatus());
        verifyNoInteractions(chain, db);
    }

    @Test
    void apiRequestUsesDevUserWhenEnabled() throws Exception {
        CurrentUserFilter filter = new CurrentUserFilter(true, "dev-user-001", db);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/records");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertEquals(200, response.getStatus());
        verify(db).update("INSERT INTO app_user(id) VALUES (?) ON CONFLICT DO NOTHING", "dev-user-001");
        verify(chain).doFilter(request, response);
    }

    @Test
    void apiRequestUsesAuthenticatedHeaderWhenDevUserDisabled() throws Exception {
        CurrentUserFilter filter = new CurrentUserFilter(false, "dev-user-001", db);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/records");
        request.addHeader("X-Authenticated-User", "user-123");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertEquals(200, response.getStatus());
        verify(db).update("INSERT INTO app_user(id) VALUES (?) ON CONFLICT DO NOTHING", "user-123");
        verify(chain).doFilter(request, response);
    }
}
