import type {
  QueryTimePendingEntityResolverOutput,
  QueryTimePendingEntityResolverInput,
} from '../retrieval/QueryTimePendingEntityResolver.js';

export interface QueryTimePendingEntityResolutionHookOutput extends QueryTimePendingEntityResolverOutput {
  hookRan: boolean;
}

export interface QueryTimePendingEntityResolutionHook {
  resolve(input: QueryTimePendingEntityResolverInput): QueryTimePendingEntityResolutionHookOutput;
}
