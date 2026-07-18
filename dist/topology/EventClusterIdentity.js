export function eventClusterKey(type, value) {
    return `${type}:${value}`;
}
export function isCanonicalEventClusterKey(type, key) {
    return key.startsWith(`${type}:`) && key.length > type.length + 1;
}
