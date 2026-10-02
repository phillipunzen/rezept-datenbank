-- CreateTable
CREATE TABLE `Cookbook` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `creatorId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(2000) NOT NULL DEFAULT '',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Cookbook_householdId_updatedAt_idx`(`householdId`, `updatedAt`),
    INDEX `Cookbook_creatorId_idx`(`creatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CookbookRecipe` (
    `cookbookId` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CookbookRecipe_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`cookbookId`, `recipeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealPlanEntry` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `creatorId` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `date` DATE NOT NULL,
    `slot` VARCHAR(12) NOT NULL,
    `servings` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MealPlanEntry_householdId_date_idx`(`householdId`, `date`),
    INDEX `MealPlanEntry_creatorId_idx`(`creatorId`),
    INDEX `MealPlanEntry_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShoppingList` (
    `id` VARCHAR(30) NOT NULL,
    `householdId` VARCHAR(30) NOT NULL,
    `creatorId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShoppingList_householdId_updatedAt_idx`(`householdId`, `updatedAt`),
    INDEX `ShoppingList_creatorId_idx`(`creatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShoppingListItem` (
    `id` VARCHAR(30) NOT NULL,
    `listId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `mergeKey` VARCHAR(200) NOT NULL,
    `amount` DECIMAL(20, 4) NULL,
    `unit` VARCHAR(24) NOT NULL DEFAULT '',
    `note` VARCHAR(2000) NOT NULL DEFAULT '',
    `checked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ShoppingListItem_listId_checked_createdAt_idx`(`listId`, `checked`, `createdAt`),
    INDEX `ShoppingListItem_listId_mergeKey_idx`(`listId`, `mergeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CookingHistory` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `recipeId` VARCHAR(30) NOT NULL,
    `requestKey` VARCHAR(100) NOT NULL,
    `cookedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `servings` INTEGER NOT NULL,
    `note` VARCHAR(2000) NOT NULL DEFAULT '',

    INDEX `CookingHistory_userId_cookedAt_idx`(`userId`, `cookedAt`),
    INDEX `CookingHistory_recipeId_idx`(`recipeId`),
    UNIQUE INDEX `CookingHistory_userId_requestKey_key`(`userId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Cookbook` ADD CONSTRAINT `Cookbook_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cookbook` ADD CONSTRAINT `Cookbook_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookbookRecipe` ADD CONSTRAINT `CookbookRecipe_cookbookId_fkey` FOREIGN KEY (`cookbookId`) REFERENCES `Cookbook`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookbookRecipe` ADD CONSTRAINT `CookbookRecipe_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealPlanEntry` ADD CONSTRAINT `MealPlanEntry_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealPlanEntry` ADD CONSTRAINT `MealPlanEntry_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealPlanEntry` ADD CONSTRAINT `MealPlanEntry_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShoppingList` ADD CONSTRAINT `ShoppingList_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShoppingList` ADD CONSTRAINT `ShoppingList_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShoppingListItem` ADD CONSTRAINT `ShoppingListItem_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `ShoppingList`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookingHistory` ADD CONSTRAINT `CookingHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CookingHistory` ADD CONSTRAINT `CookingHistory_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

