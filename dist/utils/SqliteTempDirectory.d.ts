/**
 * SQLite's temporary directory, and what to say when it cannot be used.
 *
 * `VACUUM` genuinely needs a temp file. SQLite resolves the directory from
 * `SQLITE_TMPDIR`, then `TMPDIR`, then `/var/tmp`, and it does so before any
 * application code runs — so it cannot be corrected from here afterwards, and
 * `PRAGMA temp_store_directory` is deprecated and ignored. When the directory
 * cannot be written, SQLite reports `unable to open database file`, which names
 * the database: the database is fine, and the reader is sent after the wrong
 * thing (#64).
 *
 * These helpers exist to say the true thing instead. They are deliberately not a
 * startup check: refusing to start would break every deployment whose temp
 * directory is only needed by these two operations, and most never run them.
 */
/** The directory SQLite will use: the first candidate that exists, in its order. */
export declare function resolveSqliteTempDirectory(env?: NodeJS.ProcessEnv): string | undefined;
/**
 * Whether a temp file can actually be created there. This writes and removes a
 * probe file rather than checking mode bits: inside a sandbox the two disagree,
 * and the write is the one SQLite will attempt.
 */
export declare function sqliteTempDirectoryIsWritable(directory: string): boolean;
/**
 * Keep a connection's temporary space in memory, but only where the default would
 * fail (#61, #64, and the event-store append that surfaced the third case).
 *
 * This is deliberately conditional. Several operations need temporary space — a
 * `VACUUM`, an index build during an event append, a sort — and on a machine with a
 * usable temporary directory they should use it, because a large one belongs on disk
 * rather than in RAM. Where the directory is provably unusable, the choice is between
 * working in memory and failing with a message that blames the database, and the
 * second is what sent two investigations after the wrong thing.
 *
 * Not a startup refusal: nothing is stopped, and a deployment whose temporary
 * directory is fine is not touched at all.
 */
export declare function ensureUsableTempSpace(db: {
    exec: (sql: string) => unknown;
}, env?: NodeJS.ProcessEnv): boolean;
/**
 * A named error when a SQLite failure is really about the temporary directory,
 * or undefined when it is not.
 *
 * Returning undefined matters as much as the error does: a genuine database
 * problem must keep its own message, and relabelling it would be the same
 * misattribution in the other direction.
 */
export declare function describeSqliteTempDirectoryFailure(operation: string, error: unknown, env?: NodeJS.ProcessEnv): Error | undefined;
//# sourceMappingURL=SqliteTempDirectory.d.ts.map