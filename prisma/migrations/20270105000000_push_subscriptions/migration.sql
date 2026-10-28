-- Web Push: the browsers / installed apps that receive notifications while woli is closed.
-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same lock-down as every other table (see 20270103000000_lock_down_data_api): only the app's own role reads it.
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.push_subscriptions FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
