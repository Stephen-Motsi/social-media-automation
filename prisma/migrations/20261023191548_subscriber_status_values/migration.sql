-- New subscriber states for automatic approval (separate migration: Postgres can't use
-- a newly added enum value in the same transaction).
ALTER TYPE "SubscriberStatus" ADD VALUE 'PENDING';
ALTER TYPE "SubscriberStatus" ADD VALUE 'NEEDS_REVIEW';
ALTER TYPE "SubscriberStatus" ADD VALUE 'REJECTED';
