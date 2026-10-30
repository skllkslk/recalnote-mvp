package com.recallnote.core;

import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class CurrentUserFilter extends OncePerRequestFilter {
    private final boolean devEnabled;
    private final String devUserId;
    private final JdbcTemplate db;
    public CurrentUserFilter(@Value("${app.dev-user-enabled:false}") boolean devEnabled,
                             @Value("${app.dev-user-id:dev-user-001}") String devUserId, JdbcTemplate db) {
        this.devEnabled=devEnabled; this.devUserId=devUserId; this.db=db;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return "/actuator/health".equals(path) || path.startsWith("/actuator/health/");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String user=devEnabled ? devUserId : request.getHeader("X-Authenticated-User");
        if (user==null || user.isBlank()) { response.sendError(HttpStatus.UNAUTHORIZED.value(), "Authentication required"); return; }
        try { db.update("INSERT INTO app_user(id) VALUES (?) ON CONFLICT DO NOTHING",user); ApiController.CURRENT_USER.set(user); chain.doFilter(request,response); }
        finally { ApiController.CURRENT_USER.remove(); }
    }
}
