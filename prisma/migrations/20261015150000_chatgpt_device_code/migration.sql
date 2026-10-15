-- AlterTable
ALTER TABLE `ChatgptAccount` ADD COLUMN `provider` VARCHAR(16) NOT NULL DEFAULT 'oauth';

-- CreateTable
CREATE TABLE `ChatgptDeviceAttempt` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `accountId` VARCHAR(30) NULL,
    `accountRevision` INTEGER NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `verificationUrl` VARCHAR(200) NOT NULL,
    `userCode` VARCHAR(32) NOT NULL,
    `resultAccountId` VARCHAR(30) NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `ChatgptDeviceAttempt_userId_status_idx`(`userId`, `status`),
    INDEX `ChatgptDeviceAttempt_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChatgptDeviceAttempt` ADD CONSTRAINT `ChatgptDeviceAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

