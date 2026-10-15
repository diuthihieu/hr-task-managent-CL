-- Sign in with Microsoft (Entra ID): the account's tenant id + object id.
ALTER TABLE "users" ADD COLUMN "microsoft_sub" VARCHAR(80);

CREATE UNIQUE INDEX "users_microsoft_sub_key" ON "users"("microsoft_sub");
