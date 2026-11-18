BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128);

ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON users (firebase_uid);

DROP TABLE IF EXISTS email_verifications;

COMMIT;
