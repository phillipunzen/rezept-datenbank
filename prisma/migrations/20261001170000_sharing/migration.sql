-- AlterTable
ALTER TABLE `Household` ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Recipe` ADD COLUMN `visibility` ENUM('HOUSEHOLD', 'PRIVATE') NOT NULL DEFAULT 'HOUSEHOLD';

-- CreateTable
CREATE TABLE `HouseholdInvitation` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `inviterId` VARCHAR(30) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'EDITOR', 'VIEWER') NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedById` VARCHAR(30) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HouseholdInvitation_tokenHash_key`(`tokenHash`),
    INDEX `HouseholdInvitation_householdId_email_idx`(`householdId`, `email`),
    INDEX `HouseholdInvitation_inviterId_idx`(`inviterId`),
    INDEX `HouseholdInvitation_acceptedById_idx`(`acceptedById`),
    INDEX `HouseholdInvitation_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeGrant` (
    `recipeId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `permission` ENUM('VIEW', 'EDIT') NOT NULL DEFAULT 'VIEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecipeGrant_userId_idx`(`userId`),
    PRIMARY KEY (`recipeId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Recipe_householdId_visibility_creatorId_idx` ON `Recipe`(`householdId`, `visibility`, `creatorId`);

-- AddForeignKey
ALTER TABLE `HouseholdInvitation` ADD CONSTRAINT `HouseholdInvitation_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseholdInvitation` ADD CONSTRAINT `HouseholdInvitation_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseholdInvitation` ADD CONSTRAINT `HouseholdInvitation_acceptedById_fkey` FOREIGN KEY (`acceptedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeGrant` ADD CONSTRAINT `RecipeGrant_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeGrant` ADD CONSTRAINT `RecipeGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

