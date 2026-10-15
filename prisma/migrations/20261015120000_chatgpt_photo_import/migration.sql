-- CreateTable
CREATE TABLE `ChatgptAccount` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `clientId` VARCHAR(255) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `encryptedTokens` LONGTEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `blocked` BOOLEAN NOT NULL DEFAULT false,
    `creditsConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `leaseToken` CHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,

    INDEX `ChatgptAccount_userId_active_idx`(`userId`, `active`),
    UNIQUE INDEX `ChatgptAccount_userId_clientId_key`(`userId`, `clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatgptPairing` (
    `tokenHash` CHAR(64) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `accountId` VARCHAR(30) NULL,
    `accountRevision` INTEGER NULL,
    `nonce` VARCHAR(100) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `ChatgptPairing_userId_idx`(`userId`),
    INDEX `ChatgptPairing_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChatgptAccount` ADD CONSTRAINT `ChatgptAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatgptPairing` ADD CONSTRAINT `ChatgptPairing_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

