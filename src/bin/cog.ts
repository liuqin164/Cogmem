#!/usr/bin/env bun
/**
 * The product's own entry point: `cog`.
 *
 * 5.0 makes Cog a resident companion agent rather than a memory backend other agents
 * plug into (Ryu 2026-11-12). The shell that speaks for the companion is #167's work
 * and is not built yet, so this round gives the name somewhere to live: `cog` is the
 * same dispatcher `cogmem` has always been, under the product's name, and adds no
 * behaviour. `cogmem` stays the management CLI (doctor / update / observatory / …);
 * when the shell lands it grows here without moving that surface.
 */
import './cogmem.js';
