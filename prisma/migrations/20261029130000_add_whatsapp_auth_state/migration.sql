-- CreateTable
CREATE TABLE "WhatsAppAuthState" (
    "channelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "WhatsAppAuthState_pkey" PRIMARY KEY ("channelId","key")
);
