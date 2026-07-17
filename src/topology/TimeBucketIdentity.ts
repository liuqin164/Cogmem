import { createHash } from 'node:crypto';
import type { TimeBucketType } from '../types/index.js';

export function timeBucketId(input: {
  projectId?: string;
  timeZone: string;
  bucketType: TimeBucketType;
  bucketStart: number;
  bucketEnd: number;
}): string {
  const scope = input.projectId ?? '';
  const digest = createHash('sha256')
    .update(`${scope}\0${input.timeZone}\0${input.bucketType}\0${input.bucketStart}\0${input.bucketEnd}`)
    .digest('hex')
    .slice(0, 32);
  return `${input.bucketType}:${digest}`;
}
