package com.recallnote.core;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SocialIdentityService {
    private final JdbcTemplate db;
    public SocialIdentityService(JdbcTemplate db) { this.db = db; }

    @Transactional
    public String resolve(String subject) {
        // Serialize first sign-ins for the same identity across application instances.
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "google:" + subject);
        var users = db.queryForList("SELECT user_id FROM social_identity WHERE provider='google' AND subject=?", String.class, subject);
        if (!users.isEmpty()) return users.get(0);
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO app_user(id) VALUES (?)", id);
        db.update("INSERT INTO social_identity(provider,subject,user_id) VALUES ('google',?,?)", subject, id);
        return id;
    }
}
