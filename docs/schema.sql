CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- 1) Users
CREATE TABLE users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    CITEXT NOT NULL UNIQUE,
  password_hash            TEXT NOT NULL,
  google_sub               TEXT UNIQUE,
  display_name             TEXT UNIQUE,
  avatar_url               TEXT,
  email_verified           BOOLEAN NOT NULL DEFAULT false,
  verification_code_hash   TEXT,
  verification_expires_at  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Preflop strategies
CREATE TABLE strategies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE strategy_spots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  spot_key          TEXT NOT NULL,
  hero_position     TEXT NOT NULL,
  villain_position  TEXT,
  stack_bb_min      NUMERIC(8,2),
  stack_bb_max      NUMERIC(8,2),
  label             TEXT,
  sort_order        INT NOT NULL DEFAULT 0,
  UNIQUE (strategy_id, spot_key, hero_position, villain_position)
);

CREATE TABLE strategy_cells (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id         UUID NOT NULL REFERENCES strategy_spots(id) ON DELETE CASCADE,
  hand_code       VARCHAR(3) NOT NULL,
  raise_freq      NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (raise_freq BETWEEN 0 AND 1),
  call_freq       NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (call_freq  BETWEEN 0 AND 1),
  fold_freq       NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (fold_freq  BETWEEN 0 AND 1),
  CONSTRAINT strategy_cells_freq_sum_chk
    CHECK (ABS(raise_freq + call_freq + fold_freq - 1.0) < 0.0001),
  UNIQUE (spot_id, hand_code)
);

CREATE INDEX idx_strategy_spots_strategy ON strategy_spots(strategy_id);
CREATE INDEX idx_strategy_cells_spot ON strategy_cells(spot_id);

-- 3) Uploaded hands (PokerStars first)
CREATE TABLE hand_uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id       UUID REFERENCES strategies(id) ON DELETE SET NULL,
  room              TEXT NOT NULL DEFAULT 'pokerstars',
  original_filename TEXT NOT NULL,
  storage_path      TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','parsing','parsed','analyzed','failed')),
  hands_count       INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ
);

CREATE TABLE hands (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id         UUID NOT NULL REFERENCES hand_uploads(id) ON DELETE CASCADE,
  external_hand_id  TEXT NOT NULL,
  played_at         TIMESTAMPTZ,
  table_name        TEXT,
  small_blind       NUMERIC(12,2),
  big_blind         NUMERIC(12,2),
  hero_name         TEXT,
  hero_position     TEXT,
  hero_hand         VARCHAR(4),
  hero_hand_code    VARCHAR(3),
  detected_spot     TEXT,
  villain_position  TEXT,
  stack_bb          NUMERIC(8,2),
  raw_text          TEXT NOT NULL,
  UNIQUE (upload_id, external_hand_id)
);

CREATE TABLE hand_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id         UUID NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  street          TEXT NOT NULL CHECK (street IN ('preflop','flop','turn','river')),
  action_order    INT NOT NULL,
  player_name     TEXT NOT NULL,
  is_hero         BOOLEAN NOT NULL DEFAULT false,
  action          TEXT NOT NULL,
  amount          NUMERIC(12,2),
  UNIQUE (hand_id, street, action_order)
);

CREATE TABLE deviations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id           UUID NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id       UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  spot_id           UUID REFERENCES strategy_spots(id) ON DELETE SET NULL,
  hand_code         VARCHAR(3) NOT NULL,
  actual_action     TEXT NOT NULL,
  expected_action   TEXT NOT NULL,
  actual_freq       NUMERIC(5,4),
  expected_freq     NUMERIC(5,4),
  severity          NUMERIC(5,4),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hand_id, strategy_id)
);

CREATE INDEX idx_hands_upload ON hands(upload_id);
CREATE INDEX idx_hands_spot_code ON hands(detected_spot, hero_hand_code);
CREATE INDEX idx_deviations_user ON deviations(user_id, created_at DESC);
CREATE INDEX idx_deviations_strategy ON deviations(strategy_id);
CREATE INDEX idx_hand_uploads_user ON hand_uploads(user_id);
CREATE INDEX idx_strategies_user ON strategies(user_id);
