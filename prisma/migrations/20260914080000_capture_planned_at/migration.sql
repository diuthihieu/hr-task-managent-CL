-- Put All Things On now captures a precise planned date/time instead of a
-- rough timing bucket (now/today/tomorrow/this_week/later).
ALTER TABLE "CapturedThought" DROP COLUMN "roughTiming";
ALTER TABLE "CapturedThought" ADD COLUMN "plannedAt" TIMESTAMP(3);
