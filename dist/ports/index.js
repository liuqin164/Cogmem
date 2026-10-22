/**
 * Domain-level persistence ports.
 *
 * Upper layers depend on these interfaces, never on a SQL client. Each method
 * expresses a memory operation ("append a raw event", "commit a governance
 * plan"), so a storage backend can be replaced without the kernel learning
 * about it.
 *
 * All methods are async by contract. A synchronous backend simply returns an
 * already-resolved promise; an asynchronous backend awaits its driver.
 */
export {};
