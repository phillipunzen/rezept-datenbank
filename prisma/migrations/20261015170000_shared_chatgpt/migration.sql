CREATE TABLE `ChatgptInstance` (
    `id` VARCHAR(30) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `accountId` VARCHAR(30) NULL,
    UNIQUE INDEX `ChatgptInstance_accountId_key` (`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChatgptInstance` ADD CONSTRAINT `ChatgptInstance_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `ChatgptAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
