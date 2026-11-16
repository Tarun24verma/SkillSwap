-- =============================================================
--  SkillSwap Database Schema
--  Database: skillswap_db
-- =============================================================

-- Drop tables in reverse dependency order (for clean re-runs)
DROP TABLE IF EXISTS credit_purchases CASCADE;
DROP TABLE IF EXISTS transactions    CASCADE;
DROP TABLE IF EXISTS sessions        CASCADE;
DROP TABLE IF EXISTS user_skills     CASCADE;
DROP TABLE IF EXISTS subjects        CASCADE;
DROP TABLE IF EXISTS users           CASCADE;


-- =============================================================
--  USERS
--  - Every real user starts with 5 credits.
--  - id = 0 is reserved as the platform wallet (system account).
--  - credits    : spendable balance (no hard cap enforced here;
--                 the "buy only if < 5" rule is enforced in app logic).
--  - rating     : average tutor rating (1.00 – 5.00), NULL until rated.
--  - total_sessions_taught / _taken : quick stats for profile page.
-- =============================================================
CREATE TABLE users (
    id                    SERIAL PRIMARY KEY,
    name                  VARCHAR(100)        NOT NULL,
    email                 VARCHAR(150)        NOT NULL UNIQUE,
    password_hash         VARCHAR(255)        NOT NULL,
    role                  VARCHAR(10)         NOT NULL DEFAULT 'both'
                              CHECK (role IN ('student', 'tutor', 'both')),
    credits               INT                 NOT NULL DEFAULT 5
                              CHECK (credits >= 0),
    rating                NUMERIC(3, 2)       CHECK (rating BETWEEN 1.00 AND 5.00),
    total_sessions_taught INT                 NOT NULL DEFAULT 0,
    total_sessions_taken  INT                 NOT NULL DEFAULT 0,
    created_at            TIMESTAMP           NOT NULL DEFAULT NOW()
);

-- Platform wallet — system account used to collect the session sink fee.
-- Inserted once; never a real login account.
INSERT INTO users (id, name, email, password_hash, role, credits)
VALUES (0, 'Platform', 'platform@skillswap.internal', 'NOT_A_REAL_HASH', 'both', 0);


-- =============================================================
--  SUBJECTS
--  e.g. { name: 'Data Structures', code: 'CS201' }
-- =============================================================
CREATE TABLE subjects (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(150) NOT NULL,
    code    VARCHAR(20)  UNIQUE          -- optional course code
);


-- =============================================================
--  USER_SKILLS
--  Records what a user can teach or wants to learn.
-- =============================================================
CREATE TABLE user_skills (
    user_id     INT         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    subject_id  INT         NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    skill_level VARCHAR(15) NOT NULL DEFAULT 'beginner'
                    CHECK (skill_level IN ('beginner', 'intermediate', 'advanced')),
    can_teach   BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, subject_id)
);


-- =============================================================
--  SESSIONS
--  Lifecycle: pending → confirmed → completed | cancelled
--
--  Credit flow on completion (enforced in app logic / trigger):
--    Student  pays  5 credits
--    Tutor    earns 4 credits
--    Platform earns 1 credit  (sink — keeps total supply stable)
-- =============================================================
CREATE TABLE sessions (
    id            SERIAL PRIMARY KEY,
    tutor_id      INT         NOT NULL REFERENCES users(id),
    student_id    INT         NOT NULL REFERENCES users(id),
    subject_id    INT         NOT NULL REFERENCES subjects(id),
    status        VARCHAR(15) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
    scheduled_at  TIMESTAMP   NOT NULL,
    duration_mins INT         NOT NULL DEFAULT 60
                      CHECK (duration_mins > 0),
    student_rating    SMALLINT    CHECK (student_rating BETWEEN 1 AND 5),
    student_feedback  TEXT,
    created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),

    CHECK (tutor_id <> student_id)   -- can't tutor yourself
);


-- =============================================================
--  TRANSACTIONS
--  Full audit trail of every credit movement.
--
--  transaction_type values:
--    'session_charge'    – deducted from student on session completion
--    'session_earning'   – credited to tutor on session completion
--    'platform_fee'      – 1 credit routed to platform wallet (sink)
--    'purchase'          – credits added when user buys with real money
--    'signup_bonus'      – 5 free credits given on registration
-- =============================================================
CREATE TABLE transactions (
    id               SERIAL PRIMARY KEY,
    sender_id        INT          NOT NULL REFERENCES users(id),
    receiver_id      INT          NOT NULL REFERENCES users(id),
    amount           INT          NOT NULL CHECK (amount > 0),
    transaction_type VARCHAR(20)  NOT NULL
                         CHECK (transaction_type IN (
                             'session_charge',
                             'session_earning',
                             'platform_fee',
                             'purchase',
                             'signup_bonus'
                         )),
    session_id       INT          REFERENCES sessions(id) ON DELETE SET NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);


-- =============================================================
--  CREDIT_PURCHASES
--  Records every real-money top-up (e.g. via Razorpay).
--
--  Business rules enforced in app logic (NOT here, so error
--  messages can be user-friendly):
--    1. User's current credits must be < 5 to initiate a purchase.
--    2. Credits bought may not push balance above 10.
--       → max_buyable = 10 − current_credits
--
--  payment_status: 'pending' until Razorpay webhook confirms.
-- =============================================================
CREATE TABLE credit_purchases (
    id              SERIAL PRIMARY KEY,
    user_id         INT             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits_bought  INT             NOT NULL CHECK (credits_bought > 0),
    amount_paid     NUMERIC(10, 2)  NOT NULL CHECK (amount_paid > 0),  -- INR
    payment_ref     VARCHAR(255),                                       -- Razorpay order/payment ID
    payment_status  VARCHAR(10)     NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending', 'success', 'failed')),
    purchased_at    TIMESTAMP       NOT NULL DEFAULT NOW()
);


-- =============================================================
--  INDEXES  (speeds up the most common queries)
-- =============================================================
CREATE INDEX idx_sessions_tutor     ON sessions(tutor_id);
CREATE INDEX idx_sessions_student   ON sessions(student_id);
CREATE INDEX idx_sessions_status    ON sessions(status);
CREATE INDEX idx_transactions_sender   ON transactions(sender_id);
CREATE INDEX idx_transactions_receiver ON transactions(receiver_id);
CREATE INDEX idx_transactions_session  ON transactions(session_id);
CREATE INDEX idx_user_skills_subject   ON user_skills(subject_id);
CREATE INDEX idx_credit_purchases_user ON credit_purchases(user_id);