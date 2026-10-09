-- Older API instances omit sessionId on INSERT. Preserve their login/refresh
-- writes during rolling deployment; new instances always supply a stable session.
CREATE FUNCTION "assign_legacy_refresh_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sessionId" IS NULL THEN
    NEW."sessionId" := NEW."id";
    INSERT INTO "AuthSession" ("id", "userId", "expiresAt", "revokedAt", "createdAt")
    VALUES (NEW."id", NEW."userId", NEW."expiresAt", NEW."revokedAt", NEW."createdAt");
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "assign_legacy_refresh_session"
BEFORE INSERT ON "RefreshToken"
FOR EACH ROW EXECUTE FUNCTION "assign_legacy_refresh_session"();
