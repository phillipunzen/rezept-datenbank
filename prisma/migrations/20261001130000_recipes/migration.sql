-- CreateTable
CREATE TABLE `Recipe` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `creatorId` VARCHAR(30) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `servings` INTEGER NOT NULL DEFAULT 4,
    `prepMinutes` INTEGER NOT NULL DEFAULT 0,
    `cookMinutes` INTEGER NOT NULL DEFAULT 0,
    `difficulty` VARCHAR(10) NOT NULL DEFAULT 'EASY',
    `vegetarian` BOOLEAN NOT NULL DEFAULT false,
    `vegan` BOOLEAN NOT NULL DEFAULT false,
    `source` VARCHAR(250) NOT NULL DEFAULT '',
    `sourceUrl` VARCHAR(2048) NOT NULL DEFAULT '',
    `notes` TEXT NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Recipe_householdId_deletedAt_updatedAt_idx`(`householdId`, `deletedAt`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ingredient` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `normalizedName` VARCHAR(150) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Ingredient_householdId_normalizedName_key`(`householdId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Unit` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(24) NOT NULL,
    `normalizedName` VARCHAR(24) NOT NULL,
    `dimension` VARCHAR(20) NOT NULL,
    `baseFactor` DECIMAL(12, 4) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Unit_householdId_normalizedName_key`(`householdId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeIngredientGroup` (
    `id` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `position` INTEGER NOT NULL,

    UNIQUE INDEX `RecipeIngredientGroup_recipeId_position_key`(`recipeId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeIngredient` (
    `id` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `ingredientId` VARCHAR(30) NOT NULL,
    `unitId` VARCHAR(30) NULL,
    `groupId` VARCHAR(30) NULL,
    `position` INTEGER NOT NULL,
    `amount` DECIMAL(12, 4) NULL,
    `note` VARCHAR(250) NOT NULL DEFAULT '',

    INDEX `RecipeIngredient_ingredientId_idx`(`ingredientId`),
    INDEX `RecipeIngredient_unitId_idx`(`unitId`),
    INDEX `RecipeIngredient_groupId_idx`(`groupId`),
    UNIQUE INDEX `RecipeIngredient_recipeId_position_key`(`recipeId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeStep` (
    `id` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `position` INTEGER NOT NULL,
    `instruction` TEXT NOT NULL,
    `durationSeconds` INTEGER NULL,

    UNIQUE INDEX `RecipeStep_recipeId_position_key`(`recipeId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeImage` (
    `id` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `storageKey` VARCHAR(80) NOT NULL,
    `mimeType` VARCHAR(32) NOT NULL DEFAULT 'image/webp',
    `bytes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RecipeImage_storageKey_key`(`storageKey`),
    INDEX `RecipeImage_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `normalizedName` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tag_householdId_normalizedName_key`(`householdId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeTag` (
    `recipeId` VARCHAR(30) NOT NULL,
    `tagId` VARCHAR(30) NOT NULL,

    INDEX `RecipeTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`recipeId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `normalizedName` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_householdId_normalizedName_key`(`householdId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeCategory` (
    `recipeId` VARCHAR(30) NOT NULL,
    `categoryId` VARCHAR(30) NOT NULL,

    INDEX `RecipeCategory_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`recipeId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Favorite` (
    `recipeId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Favorite_userId_idx`(`userId`),
    PRIMARY KEY (`recipeId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rating` (
    `recipeId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `value` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Rating_userId_idx`(`userId`),
    PRIMARY KEY (`recipeId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeVersion` (
    `id` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `authorId` VARCHAR(30) NOT NULL,
    `revision` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecipeVersion_authorId_idx`(`authorId`),
    UNIQUE INDEX `RecipeVersion_recipeId_revision_key`(`recipeId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Recipe` ADD CONSTRAINT `Recipe_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recipe` ADD CONSTRAINT `Recipe_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ingredient` ADD CONSTRAINT `Ingredient_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Unit` ADD CONSTRAINT `Unit_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeIngredientGroup` ADD CONSTRAINT `RecipeIngredientGroup_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeIngredient` ADD CONSTRAINT `RecipeIngredient_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeIngredient` ADD CONSTRAINT `RecipeIngredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeIngredient` ADD CONSTRAINT `RecipeIngredient_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeIngredient` ADD CONSTRAINT `RecipeIngredient_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `RecipeIngredientGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeStep` ADD CONSTRAINT `RecipeStep_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeImage` ADD CONSTRAINT `RecipeImage_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeTag` ADD CONSTRAINT `RecipeTag_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeTag` ADD CONSTRAINT `RecipeTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeCategory` ADD CONSTRAINT `RecipeCategory_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeCategory` ADD CONSTRAINT `RecipeCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Favorite` ADD CONSTRAINT `Favorite_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Favorite` ADD CONSTRAINT `Favorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeVersion` ADD CONSTRAINT `RecipeVersion_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeVersion` ADD CONSTRAINT `RecipeVersion_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

