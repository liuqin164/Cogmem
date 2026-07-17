import { createHash } from 'node:crypto';
export function timeBucketId(input) {
    const scope = input.projectId ?? '';
    const digest = createHash('sha256')
        .update(`${scope}\0${input.timeZone}\0${input.bucketType}\0${input.bucketStart}\0${input.bucketEnd}`)
        .digest('hex')
        .slice(0, 32);
    return `${input.bucketType}:${digest}`;
}
