const PRODUCT_FACETS = {
    time: 'time',
    topic: 'topic',
    entity: 'person',
    location: 'place',
    state: 'state',
};
/**
 * Translate a stored entrance into the product facet it stands for.
 * `event` is carried by a memory kind, so it only counts when that kind is
 * `event`; every other memory kind is internal.
 */
export function productFacetFor(type, value) {
    if (type === 'memoryKind')
        return value === 'event' ? 'event' : undefined;
    return PRODUCT_FACETS[type];
}
