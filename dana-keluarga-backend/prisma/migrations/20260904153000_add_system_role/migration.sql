-- Add global application role without changing existing family memberships.
CREATE TYPE "SystemRole" AS ENUM ('SUPER_ADMIN', 'USER');

ALTER TABLE "User" ADD COLUMN "systemRole" "SystemRole" NOT NULL DEFAULT 'USER';
