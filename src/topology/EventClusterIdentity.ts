import type { EventClusterType } from '../types/index.js';

export function eventClusterKey(type: EventClusterType, value: string): string {
  return `${type}:${value}`;
}

export function isCanonicalEventClusterKey(type: EventClusterType, key: string): boolean {
  return key.startsWith(`${type}:`) && key.length > type.length + 1;
}
