/** Translate a schema entrance into the product facet it stands for, if any. */
export function productFacetFor(type, value) {
    switch (type) {
        case 'time': return 'time';
        case 'topic': return 'topic';
        case 'entity': return 'person';
        case 'location': return 'place';
        case 'state': return 'state';
        case 'memoryKind': return value === 'event' ? 'event' : undefined;
        default: return undefined;
    }
}
