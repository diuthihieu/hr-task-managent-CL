-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_View" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'grid',
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "View_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "TableDef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_View" ("config", "createdAt", "id", "isDefault", "name", "order", "tableId", "type", "updatedAt") SELECT "config", "createdAt", "id", "isDefault", "name", "order", "tableId", "type", "updatedAt" FROM "View";
DROP TABLE "View";
ALTER TABLE "new_View" RENAME TO "View";
CREATE INDEX "View_tableId_idx" ON "View"("tableId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
