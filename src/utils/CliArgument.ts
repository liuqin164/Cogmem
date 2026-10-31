/**
 * One shell-quoting rule for a command Cogmem prints.
 *
 * A printed step whose path contains a space is a step that does not run: the
 * shell splits it, and `--workspace /Users/me/My Project` fails with a file it
 * cannot find. Quoting only when the value needs it keeps the common case
 * readable.
 *
 * Four modules carried a byte-identical private copy of this function, which is
 * four places for one rule to drift — the same duplication this codebase keeps
 * paying for. It lives here now, and the printed steps use it (#78).
 */
export function cliArg(value: string): string {
  return /^[A-Za-z0-9._:/=@+-]+$/u.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
