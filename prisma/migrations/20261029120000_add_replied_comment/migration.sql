-- CreateTable
CREATE TABLE "RepliedComment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "commentId" TEXT NOT NULL,
    "postId" TEXT,
    "replied" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepliedComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepliedComment_storeId_channelType_idx" ON "RepliedComment"("storeId", "channelType");

-- CreateIndex
CREATE UNIQUE INDEX "RepliedComment_storeId_channelType_commentId_key" ON "RepliedComment"("storeId", "channelType", "commentId");
