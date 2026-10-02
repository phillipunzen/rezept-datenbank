-- CreateTable
CREATE TABLE `RecipeNutrition` (
    `recipeId` VARCHAR(30) NOT NULL,
    `calories` DECIMAL(10, 2) NULL,
    `carbohydrates` DECIMAL(10, 2) NULL,
    `fats` DECIMAL(10, 2) NULL,
    `proteins` DECIMAL(10, 2) NULL,
    `basis` VARCHAR(10) NOT NULL DEFAULT 'SERVING',
    `source` VARCHAR(250) NOT NULL DEFAULT '',

    PRIMARY KEY (`recipeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeAllergen` (
    `recipeId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(80) NOT NULL,

    PRIMARY KEY (`recipeId`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeStepIngredient` (
    `stepId` VARCHAR(30) NOT NULL,
    `ingredientId` VARCHAR(30) NOT NULL,

    INDEX `RecipeStepIngredient_ingredientId_idx`(`ingredientId`),
    PRIMARY KEY (`stepId`, `ingredientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceRecipeData` (
    `recipeId` VARCHAR(30) NOT NULL,
    `deviceKey` VARCHAR(40) NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `data` JSON NOT NULL,
    `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`recipeId`, `deviceKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportJob` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `archiveKey` VARCHAR(80) NOT NULL,
    `archiveHash` CHAR(64) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `visibility` ENUM('HOUSEHOLD', 'PRIVATE') NOT NULL DEFAULT 'PRIVATE',
    `targetBookId` VARCHAR(30) NULL,
    `preview` JSON NOT NULL,
    `error` VARCHAR(1000) NOT NULL DEFAULT '',
    `runToken` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ImportJob_archiveKey_key`(`archiveKey`),
    INDEX `ImportJob_status_leaseUntil_idx`(`status`, `leaseUntil`),
    INDEX `ImportJob_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ImportJob_householdId_idx`(`householdId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportResult` (
    `jobId` VARCHAR(30) NOT NULL,
    `position` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `message` VARCHAR(1000) NOT NULL,
    `recipeId` VARCHAR(30) NULL,

    INDEX `ImportResult_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`jobId`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportReceipt` (
    `householdId` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,

    INDEX `ImportReceipt_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`householdId`, `kind`, `contentHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShareLink` (
    `id` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShareLink_tokenHash_key`(`tokenHash`),
    INDEX `ShareLink_recipeId_createdAt_idx`(`recipeId`, `createdAt`),
    INDEX `ShareLink_userId_idx`(`userId`),
    INDEX `ShareLink_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecipeNutrition` ADD CONSTRAINT `RecipeNutrition_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeAllergen` ADD CONSTRAINT `RecipeAllergen_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeStepIngredient` ADD CONSTRAINT `RecipeStepIngredient_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `RecipeStep`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeStepIngredient` ADD CONSTRAINT `RecipeStepIngredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `RecipeIngredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceRecipeData` ADD CONSTRAINT `DeviceRecipeData_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportJob` ADD CONSTRAINT `ImportJob_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportJob` ADD CONSTRAINT `ImportJob_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportResult` ADD CONSTRAINT `ImportResult_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `ImportJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportResult` ADD CONSTRAINT `ImportResult_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportReceipt` ADD CONSTRAINT `ImportReceipt_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportReceipt` ADD CONSTRAINT `ImportReceipt_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShareLink` ADD CONSTRAINT `ShareLink_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShareLink` ADD CONSTRAINT `ShareLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

