/**
 * 4.0 ships one schema and no upgrade path (ADR-0007).
 *
 * There is no ordered migration list, no runner to replay one, and no migration
 * object. A new database is created from the final schema by `createFinalSchema`
 * in `./v3_7_4/FinalSchema.js`, and a database this release did not create is
 * refused. `./v3_7_4/FinalSchemaDefinition.js` holds the schema itself, and
 * `./v3_7_4/FinalSchemaInstall.ts` installs it.
 */
export {};
