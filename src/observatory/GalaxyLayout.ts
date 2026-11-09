/**
 * Where a star sits in the star map.
 *
 * A pure function of the corpus, so the same database opens onto the same galaxy every time: an
 * observational view that rearranged itself between two openings would make "I saw it over there"
 * useless, and a force-directed layout is exactly that kind of drift.
 *
 * What each coordinate means is a deliberate, narrow choice (`docs/observatory.md`): the arm is the
 * node's top-level grouping, and nothing else is encoded. Radius is a hash scatter, not support or
 * age — a radius that carried a second meaning would be a reading the data does not support.
 */

/** FNV-1a over the id and a salt, so one id yields three independent uniforms deterministically. */
function hash32(text: string, salt: number): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function uniform(text: string, salt: number): number {
  return hash32(text, salt) / 0x100000000;
}

export interface GalaxyInput {
  id: string;
  /** Top-level grouping: the arm this node is strung along. */
  arm: string;
}

export interface GalaxyPoint {
  x: number;
  y: number;
  z: number;
}

export interface GalaxyLayoutOptions {
  /** Disc radius in world units. */
  radius?: number;
  /** Disc half-thickness at the centre; thins towards the rim. */
  thickness?: number;
  /** How far a point may sit off its arm, in radians. */
  jitter?: number;
}

const DEFAULTS = { radius: 112, thickness: 15, jitter: 1.15 };
/**
 * Radial falloff exponent. Area-uniform would be 0.5; a little above it concentrates the disc
 * towards the middle so the map reads as a galaxy with a bulge rather than a flat ring. It is the
 * same curve for every node, so the radius still encodes nothing about a node.
 */
const RADIAL_FALLOFF = 0.78;
/** How tightly the arm coils: `theta = armBase + tightness * ln(r / innerRadius)`. */
const TIGHTNESS = 2.4;
const INNER_RADIUS = 6;

/**
 * Assign one point per node. Arms are ordered by population (largest first, then name) so the arm a
 * node lands on does not depend on the order rows came back from SQLite.
 */
export function galaxyLayout(nodes: GalaxyInput[], options: GalaxyLayoutOptions = {}): Map<string, GalaxyPoint> {
  const { radius, thickness, jitter } = { ...DEFAULTS, ...options };
  const populations = new Map<string, number>();
  for (const node of nodes) populations.set(node.arm, (populations.get(node.arm) ?? 0) + 1);
  const arms = Array.from(populations.keys()).sort((left, right) => {
    const bySize = (populations.get(right) ?? 0) - (populations.get(left) ?? 0);
    return bySize !== 0 ? bySize : left.localeCompare(right);
  });
  const armIndex = new Map(arms.map((arm, index) => [arm, index]));

  const points = new Map<string, GalaxyPoint>();
  for (const node of nodes) {
    const arm = armIndex.get(node.arm) ?? 0;
    const span = radius - INNER_RADIUS;
    // Area-uniform: without the square root the centre would be crowded and the rim sparse.
    const r = INNER_RADIUS + span * Math.pow(uniform(node.id, 0x9e3779b9), RADIAL_FALLOFF);
    const armBase = (arm / Math.max(arms.length, 1)) * Math.PI * 2;
    const theta = armBase + TIGHTNESS * Math.log(r / INNER_RADIUS) + (uniform(node.id, 0x85ebca6b) - 0.5) * jitter;
    // Thin towards the rim, the way a disc does, so the core reads as a bulge rather than a slab.
    const y = (uniform(node.id, 0xc2b2ae35) - 0.5) * 2 * thickness * Math.exp(-r / radius);
    points.set(node.id, { x: r * Math.cos(theta), z: r * Math.sin(theta), y });
  }
  return points;
}

/**
 * The arm a node belongs to: the first segment of its topic path, its one-hop topic, or its project.
 *
 * This is the note's L0 rule (`topic` / `cluster` / `project`) applied to a corpus that has no topic
 * nodes — measured on the 20,343-event corpus, every node has a null `topic_path`, so the whole
 * corpus lands on one arm and the map is a single spiral. The page states which rule produced the
 * arms rather than implying themes that are not there.
 */
export function armKeyFor(node: { topicPath?: string; topicArm?: string; projectId: string }): string {
  const top = node.topicPath?.split('/')[0]?.trim();
  if (top) return top;
  if (node.topicArm) return node.topicArm;
  return node.projectId;
}
