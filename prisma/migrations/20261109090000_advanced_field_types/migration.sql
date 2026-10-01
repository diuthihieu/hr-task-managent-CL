-- Enum values are committed in their own migration because PostgreSQL cannot
-- reliably use a newly-added enum value in the same transaction that adds it.
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'team';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'location';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'signature';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'link';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'lookup';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'rollup';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'button';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'barcode';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'ai_field';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'json';
ALTER TYPE "custom_field_type" ADD VALUE IF NOT EXISTS 'api_result';
