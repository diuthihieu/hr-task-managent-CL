-- Files attached to an AI chat turn (metadata + extracted document text).
ALTER TABLE "ai_messages" ADD COLUMN "attachments" JSONB;
