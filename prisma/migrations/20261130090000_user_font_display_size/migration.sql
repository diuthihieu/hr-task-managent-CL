-- Per-user text size and display (UI) size.
ALTER TABLE "users" ADD COLUMN "font_size" VARCHAR(10) NOT NULL DEFAULT 'md';
ALTER TABLE "users" ADD COLUMN "display_size" VARCHAR(12) NOT NULL DEFAULT 'default';
