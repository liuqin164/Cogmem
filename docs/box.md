# The box: Cog's evaluation venue

The box is the instabox machine `cogmem-test` (4 vCPU / 8 GB, persistent `/data`).
Every release gate is measured on it. The test suite proves the kernel works; the box
proves it works **installed**, which is a different claim.

## What the box is for

Since R4 of #200 the box is the **F13 companion-behaviour evaluation venue** (#167).
The 5.0 release gate is:

- **a seven-day survival run** — one resident install left running on the box with the
  observatory up, for seven days; and
- **the F13 companion-behaviour evaluation**, measured on that same box.

There is **no host-compatibility gate**. The three third-party hosts the box was once
wired for (OpenClaw, Hermes, pi) are leaving Cog's support surface with #200, and the
host-matrix check that used to run here (`scripts/verify-host-memory.sh`) went with them.
F13 measures Cog's own companion behaviour, not another agent's ability to connect.

The rule that has not changed: **nothing ships that has not been run on the box.** A
candidate is measured as an installed artifact a user would get, not only as a checkout
that passes `bun test`.

This file is the venue, not the evaluation: the F13 body itself is #167's work and is
not implemented here.

## What is preset, and what a run installs

OpenClaw, Hermes and pi are **platform-preset** on the image: they predate Cog, no
Cog round installs or wires them, and no gate depends on them. Leave them alone.

Cog itself is **not** preset. A run starts from a real `npm install` of the candidate
tarball into its own prefix (`/data/home/.npm-global`) and its own workspace, so the
measurement is of the packed artifact rather than the tree it was built from.

## Cleanup after a run

A run leaves the box in **first-install state** before it is paused, and the box ends
`Paused`:

- stop every Cog process and every listener a run opened (4873 / 7337 / 7391 / 7401);
- remove the round's trees, tarballs and scenario scripts;
- confirm `which cogmem` is empty, `find /data/home /data/workspace /tmp -iname '*cogmem*'`
  returns nothing, and the host configs (`openclaw.json`, Hermes `config.yaml`, pi
  `mcp.json`) name Cog zero times;
- leave host installs, model configuration and credentials intact.

The same check is a script in the round that ran it, not a paragraph: rounds keep their
own cleanup script under `.cogmem/` (untracked) and paste its output into the round report.
