/**
 * The six ways a person locates a memory (GLOSSARY.md). A stored entrance may
 * stand for one of these; an internal entrance stands for none.
 */
export type ProductFacet = 'time' | 'person' | 'place' | 'event' | 'topic' | 'state';
/**
 * Translate a stored entrance into the product facet it stands for.
 * `event` is carried by a memory kind, so it only counts when that kind is
 * `event`; every other memory kind is internal.
 */
export declare function productFacetFor(type: string, value: string): ProductFacet | undefined;
//# sourceMappingURL=ProductFacet.d.ts.map