-- CreateTable
CREATE TABLE `AccountStatus` (
    `userId` VARCHAR(30) NOT NULL,
    `disabled` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileAvatar` (
    `userId` VARCHAR(30) NOT NULL,
    `storageKey` VARCHAR(80) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProfileAvatar_storageKey_key`(`storageKey`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordReset` (
    `tokenHash` CHAR(64) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PasswordReset_userId_idx`(`userId`),
    INDEX `PasswordReset_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OidcIdentity` (
    `id` VARCHAR(30) NOT NULL,
    `issuer` VARCHAR(500) COLLATE utf8mb4_bin NOT NULL,
    `subject` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OidcIdentity_userId_idx`(`userId`),
    UNIQUE INDEX `OidcIdentity_issuer_subject_key`(`issuer`, `subject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OidcAttempt` (
    `stateHash` CHAR(64) NOT NULL,
    `browserHash` CHAR(64) NOT NULL,
    `verifier` VARCHAR(128) NOT NULL,
    `nonce` VARCHAR(128) NOT NULL,
    `userId` VARCHAR(30) NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `OidcAttempt_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`stateHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NULL,
    `action` VARCHAR(160) NOT NULL,
    `targetId` VARCHAR(30) NULL,
    `status` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountStatus` ADD CONSTRAINT `AccountStatus_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileAvatar` ADD CONSTRAINT `ProfileAvatar_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordReset` ADD CONSTRAINT `PasswordReset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OidcIdentity` ADD CONSTRAINT `OidcIdentity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

