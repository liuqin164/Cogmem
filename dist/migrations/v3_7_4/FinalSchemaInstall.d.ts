import type Database from 'bun:sqlite';
/**
 * Install the 4.0 final schema in a database that has none.
 *
 * Moved here from `0032_multidimensional_memory_graph_3_7_4.ts`, which was the
 * migration that also carried the 3.x upgrade path. This is only the part a new
 * database needs; the upgrade helpers that lived beside it are gone, and the
 * schema it produces is verified object-for-object against the old installer's
 * output (501 objects, digest pinned in `__tests__/schema-migration.unit.test.ts`).
 *
 * The postcondition check at the end is not decoration: it is what notices a
 * projection or auxiliary object that failed to install, and it runs on every
 * creation.
 */
export declare function installFinalSchema(db: Database): void;
export declare function multidimensionalMemoryGraph374Issue(db: Database): string | undefined;
//# sourceMappingURL=FinalSchemaInstall.d.ts.map