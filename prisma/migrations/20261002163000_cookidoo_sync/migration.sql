-- CreateTable
CREATE TABLE `CookidooConnection` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `listId` VARCHAR(30) NOT NULL,
    `accountEmail` VARCHAR(254) NOT NULL,
    `market` VARCHAR(5) NOT NULL,
    `encryptedTokens` LONGTEXT NOT NULL,
    `requested` BOOLEAN NOT NULL DEFAULT false,
    `paused` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `lastSyncedAt` DATETIME(3) NULL,
    `nextSyncAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `runToken` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NOT NULL DEFAULT '',
    `reportJson` JSON NULL,
    `pendingJson` JSON NULL,
    `resolutionsJson` JSON NOT NULL,
    `ignoredLocalJson` JSON NOT NULL,
    `ignoredRemoteJson` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CookidooConnection_userId_key`(`userId`),
    UNIQUE INDEX `CookidooConnection_listId_key`(`listId`),
    INDEX `CookidooConnection_paused_nextSyncAt_idx`(`paused`, `nextSyncAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CookidooItemLink` (
    `id` VARCHAR(30) NOT NULL,
    `connectionId` VARCHAR(30) NOT NULL,
    `localItemId` VARCHAR(30) NULL,
    `remoteKey` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
    `localBaseJson` JSON NOT NULL,
    `remoteBaseJson` JSON NOT NULL,

    UNIQUE INDEX `CookidooItemLink_connectionId_localItemId_key`(`connectionId`, `localItemId`),
    UNIQUE INDEX `CookidooItemLink_connectionId_remoteKey_key`(`connectionId`, `remoteKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CookidooConnection` ADD CONSTRAINT `CookidooConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookidooConnection` ADD CONSTRAINT `CookidooConnection_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookidooConnection` ADD CONSTRAINT `CookidooConnection_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `ShoppingList`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookidooItemLink` ADD CONSTRAINT `CookidooItemLink_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `CookidooConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookidooItemLink` ADD CONSTRAINT `CookidooItemLink_localItemId_fkey` FOREIGN KEY (`localItemId`) REFERENCES `ShoppingListItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

