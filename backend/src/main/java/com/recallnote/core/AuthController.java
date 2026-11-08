package com.recallnote.core;

import java.util.Map;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    @GetMapping("/auth/csrf")
    public Map<String,String> csrf(CsrfToken token) {
        return token == null ? Map.of("token", "", "headerName", "X-CSRF-TOKEN")
                : Map.of("token", token.getToken(), "headerName", token.getHeaderName());
    }
    @GetMapping("/api/v1/users/me")
    public Map<String,String> me() { return Map.of("id", ApiController.CURRENT_USER.get()); }
}
