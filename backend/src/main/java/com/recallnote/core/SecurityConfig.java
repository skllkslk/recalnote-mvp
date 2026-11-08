package com.recallnote.core;

import java.net.URI;
import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain security(HttpSecurity http, Environment environment,
            SocialIdentityService identities,
            @Value("${app.dev-user-enabled:false}") boolean dev,
            @Value("${app.public-base-url:http://localhost:3000}") String publicUrl) throws Exception {
        boolean local = Arrays.asList(environment.getActiveProfiles()).contains("local");
        URI origin = URI.create(publicUrl);
        if (origin.getHost() == null || origin.getRawQuery() != null || origin.getFragment() != null
                || (origin.getPath() != null && !origin.getPath().isEmpty() )
                || origin.getUserInfo() != null || !(origin.getScheme().equals("https") || (local && origin.getScheme().equals("http"))))
            throw new IllegalStateException("PUBLIC_BASE_URL must be a fixed HTTPS origin (HTTP allowed only in local profile)");
        if (!local && !environment.getProperty("app.session-cookie-secure", Boolean.class, true))
            throw new IllegalStateException("Secure session cookies are required outside local profile");
        if (dev && !local) throw new IllegalStateException("DEV_USER_ENABLED is allowed only with the local profile");
        if (!dev) {
            String clientId = environment.getProperty("spring.security.oauth2.client.registration.google.client-id", "");
            String secret = environment.getProperty("spring.security.oauth2.client.registration.google.client-secret", "");
            if (clientId.isBlank() || secret.isBlank() || clientId.equals("unconfigured") || secret.equals("unconfigured"))
                throw new IllegalStateException("Google OAuth client credentials are required when development bypass is disabled");
        }
        String base = publicUrl.replaceAll("/+$", "");
        http.requestCache(cache -> cache.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/actuator/health/**", "/auth/csrf", "/oauth2/authorization/google", "/login/oauth2/code/google", "/error").permitAll()
                .anyRequest().access((authentication, context) -> new org.springframework.security.authorization.AuthorizationDecision(
                    dev || (authentication.get().isAuthenticated() && !(authentication.get() instanceof org.springframework.security.authentication.AnonymousAuthenticationToken)))))
            .exceptionHandling(errors -> errors.authenticationEntryPoint((req,res,ex) -> res.sendError(401)))
            .csrf(csrf -> { csrf.csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()); if (dev) csrf.disable(); })
            .logout(logout -> logout.logoutUrl("/auth/logout").deleteCookies("SESSION")
                .logoutSuccessHandler((req,res,auth) -> res.setStatus(204)));
        if (!dev) {
            OidcUserService delegate = new OidcUserService();
            http.oauth2Login(oauth -> oauth.userInfoEndpoint(info -> info.oidcUserService(request -> {
                var user = delegate.loadUser(request);
                String id = identities.resolve(user.getSubject());
                var claims = new java.util.LinkedHashMap<String,Object>(user.getClaims());
                claims.put("app_user_id", id);
                return new DefaultOidcUser(user.getAuthorities(), user.getIdToken(),
                    new org.springframework.security.oauth2.core.oidc.OidcUserInfo(claims), "app_user_id");
            })).successHandler((req,res,auth) -> res.sendRedirect(base + "/"))
              .failureHandler((req,res,ex) -> res.sendRedirect(base + "/?login=failed")));
        }
        return http.build();
    }

    @Bean
    DefaultCookieSerializer cookieSerializer(@Value("${app.session-cookie-secure:true}") boolean secure) {
        var cookie = new DefaultCookieSerializer();
        cookie.setCookieName("SESSION"); cookie.setCookiePath("/");
        cookie.setUseHttpOnlyCookie(true); cookie.setUseSecureCookie(secure); cookie.setSameSite("Lax");
        return cookie;
    }
}
