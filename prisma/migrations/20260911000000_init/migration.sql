CREATE TABLE "player_sessions" (
    "player_id" UUID NOT NULL,
    "token" UUID NOT NULL,
    "nickname" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_sessions_pkey" PRIMARY KEY ("player_id")
);

CREATE TABLE "room_states" (
    "id" VARCHAR(32) NOT NULL,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "player_sessions_token_key" ON "player_sessions"("token");
