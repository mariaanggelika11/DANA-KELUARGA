-- DropForeignKey
ALTER TABLE "WhatsAppMessage" DROP CONSTRAINT "WhatsAppMessage_userId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppMessage" DROP CONSTRAINT "WhatsAppMessage_familyId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "whatsappOptInAt";

-- DropTable
DROP TABLE "WhatsAppMessage";

-- DropEnum
DROP TYPE "WhatsAppMessageStatus";

