-- CreateTable
CREATE TABLE `RecipePublication` (
    `recipeId` VARCHAR(30) NOT NULL,
    `publisherId` VARCHAR(30) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,

    INDEX `RecipePublication_publishedAt_recipeId_idx`(`publishedAt`, `recipeId`),
    INDEX `RecipePublication_publisherId_idx`(`publisherId`),
    PRIMARY KEY (`recipeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecipePublication` ADD CONSTRAINT `RecipePublication_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipePublication` ADD CONSTRAINT `RecipePublication_publisherId_fkey` FOREIGN KEY (`publisherId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

