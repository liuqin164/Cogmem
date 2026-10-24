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
 * A named error when a SQLite failure is really about the temporary directory,
 * or undefined when it is not.
 *
 * Returning undefined matters as much as the error does: a genuine database
 * problem must keep its own message, and relabelling it would be the same
 * misattribution in the other direction.
 */
export declare function describeSqliteTempDirectoryFailure(operation: string, error: unknown): Error | undefined;
//# sourceMappingURL=SqliteTempDirectory.d.ts.map