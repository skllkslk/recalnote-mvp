# Google login deployment

Spring owns OAuth/OIDC and PostgreSQL-backed sessions. The browser accesses only the Next.js origin; Next.js forwards only the SESSION cookie and CSRF header. Browser-provided identity headers are ignored. Existing dev-user-001 rows remain unchanged.

## Google Cloud

Create a Web application OAuth client and configure the consent screen. While the application is in Testing, add the testers' Google accounts.

Register these exact redirect URIs (no trailing slash):

- Production: https://YOUR-VERCEL-DOMAIN/auth/callback/google
- Local: http://localhost:3000/auth/callback/google

Use a fixed production domain. Preview domains are not automatically authorized. No Drive, Notion, or offline-access permissions are requested; only openid, profile, email.

## Railway Spring service

Set:

```text
SPRING_PROFILES_ACTIVE=prod
DEV_USER_ENABLED=false
PUBLIC_BASE_URL=https://YOUR-VERCEL-DOMAIN
GOOGLE_CLIENT_ID=<Google Web OAuth client ID>
GOOGLE_CLIENT_SECRET=<Google Web OAuth client secret>
SESSION_COOKIE_SECURE=true
```

Keep existing DB and INTERNAL_API_KEY settings. Do not include a trailing slash in PUBLIC_BASE_URL. Startup rejects development-user bypass and insecure cookies outside local. The Google client secret must never be a NEXT_PUBLIC variable.

Deploy Spring and Next.js together: the new API rejects the old identity-header mechanism. Flyway V7 creates social_identity and Spring Session tables without rewriting existing users or records. Back up production before migration. Persistent sessions contain Google identity/token information and must be protected like other private DB data. Plan to reauthenticate users if a later upgrade changes serialized session compatibility.

## Vercel

Keep API_BASE_URL pointing to the Railway Spring origin. No Google secret is needed in Vercel. Login starts at /auth/login/google. The Google callback and Spring's success/failure redirects use the configured public origin. Do not redirect HTTP to an untrusted Host or forwarded header.

## Local

Normal local development retains the existing single development user. To exercise real Google login, set SPRING_PROFILES_ACTIVE=local, DEV_USER_ENABLED=false, SESSION_COOKIE_SECURE=false, PUBLIC_BASE_URL=http://localhost:3000 and the Google client credentials. Compose forwards these settings to Spring. Next.js should have API_BASE_URL=http://localhost:8080.

## Validation

Run backend tests with JDK 17 and `mvn test`; frontend checks with `pnpm test:auth`, `pnpm exec tsc --noEmit` and `pnpm build`.

The old Python flow harness used X-Authenticated-User. That mechanism has deliberately been removed; it cannot authenticate to this release. Use the Java security tests, and the opt-in PostgreSQL tests below. Do not re-enable header authentication to run the old harness.

For real PostgreSQL migration, ownership and session serialization checks, create a disposable empty test database (never use the application database), then set TEST_DB_URL, TEST_DB_USER and TEST_DB_PASSWORD and run `mvn test`. PostgreSQLSecurityTest is skipped unless TEST_DB_URL is set.

Before admitting testers, verify on the deployed app:

1. Logged-out API requests return 401; forged X-Authenticated-User cannot authenticate.
2. Google account A completes onboarding and creates a private record.
3. A separate browser profile logs in as account B; A's data is absent and A's record/session/proposal IDs cannot be read or modified.
4. Logout invalidates the session; replaying its previous SESSION cookie does not restore access.
5. Login cancellation returns a helpful error. A Spring restart retains an otherwise valid session.
6. Mutations without CSRF return 403, and the normal app can create/edit/delete records and approve results.

The application uses Google sub, not email, for identity. New identities receive random internal user IDs. Same-email accounts are not automatically merged. Existing development data is not assigned to the first person who logs in.
