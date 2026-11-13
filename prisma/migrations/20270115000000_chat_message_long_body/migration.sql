-- Woli AI reports are read in the message itself, so a message body is no longer limited to 4,000
-- characters in the database. People's messages keep their 4,000-character limit in the application.
-- varchar -> text needs no table rewrite.
ALTER TABLE "chat_messages" ALTER COLUMN "body" TYPE TEXT;
