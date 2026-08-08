import { IntentParser } from '../core/IntentParser.js';
import type { QueryIR } from '../types/query-ir.js';
import type { LocalSemanticCompiler, SemanticCompilation } from '../engine/LocalSemanticCompiler.js';
import type { EntityResolutionEngine, EntityResolutionResult } from '../engine/EntityResolutionEngine.js';
import { NativeQueryParser } from './NativeQueryParser.js';
import { assertLocalDate, localDateRange, nextCivilDate, resolveProjectClockContext, type ProjectClockContext } from '../utils/LocalDateContext.js';

export interface CompiledQuery {
  ir: QueryIR;
  semanticCompilation: SemanticCompilation;
  entityResolution: EntityResolutionResult;
}

export class QueryCompiler {
  private nativeQueryParser = new NativeQueryParser();

  constructor(
    private semanticCompiler: LocalSemanticCompiler,
    private entityResolutionEngine: EntityResolutionEngine
  ) {}

  compile(query: string, projectId?: string, clock?: Pick<ProjectClockContext, 'now' | 'localDateNow' | 'timeZone'>): CompiledQuery {
    const resolvedClock = clock ?? resolveProjectClockContext();
    const nativeQuery = this.nativeQueryParser.parse(query);
    const effectiveQuery = nativeQuery.residualQuery || query;
    const baseIr = IntentParser.parse(effectiveQuery);
    const semanticCompilation = this.semanticCompiler.compileQuery({ text: effectiveQuery, projectId });
    const nativeDirectives = nativeQuery.directives;
    const ir: QueryIR = {
      ...baseIr,
      semantics: this.semanticCompiler.mergeIntoSemantics(baseIr.semantics, semanticCompilation),
      nativeDirectives,
      nativeQueryDebug: {
        parseMode: nativeQuery.parseMode,
        residualQuery: nativeQuery.residualQuery,
        clauses: nativeQuery.clauses.map((clause) => ({ key: clause.key, value: clause.value }))
      }
    };

    if (!ir.spatial.projectId && nativeDirectives?.project) {
      ir.spatial.projectId = nativeDirectives.project;
    }
    if (nativeDirectives?.entity) {
      ir.entities = Array.from(new Set([nativeDirectives.entity, ...ir.entities]));
      ir.semantics.entityHints = Array.from(new Set([nativeDirectives.entity, ...ir.semantics.entityHints]));
    }
    if (nativeDirectives?.entityType) {
      ir.semantics.valueHints = Array.from(new Set([nativeDirectives.entityType, ...ir.semantics.valueHints]));
    }
    if (nativeDirectives?.branch) {
      ir.shouldMatch = Array.from(new Set([nativeDirectives.branch, ...ir.shouldMatch]));
      ir.semantics.valueHints = Array.from(new Set([nativeDirectives.branch, ...ir.semantics.valueHints]));
    }
    if (nativeDirectives?.task) {
      ir.shouldMatch = Array.from(new Set([nativeDirectives.task, ...ir.shouldMatch]));
      ir.semantics.valueHints = Array.from(new Set([nativeDirectives.task, ...ir.semantics.valueHints]));
    }
    if (nativeDirectives?.cluster) {
      ir.shouldMatch = Array.from(new Set([nativeDirectives.cluster, ...ir.shouldMatch]));
      ir.semantics.valueHints = Array.from(new Set([nativeDirectives.cluster, ...ir.semantics.valueHints]));
    }

    if (!ir.temporal.relative && semanticCompilation.temporalHints.length > 0) {
      ir.temporal.relative = semanticCompilation.temporalHints[0];
    }
    if (!ir.temporal.relative && nativeDirectives?.time) {
      ir.temporal.relative = this.mapNativeTime(nativeDirectives.time);
    }
    if (ir.temporal.start === undefined && nativeDirectives?.from) {
      const start = this.parseNativeDate(nativeDirectives.from, resolvedClock.timeZone);
      if (start !== undefined) ir.temporal.start = start;
    }
    if (ir.temporal.end === undefined && nativeDirectives?.to) {
      const end = this.parseNativeDate(nativeDirectives.to, resolvedClock.timeZone, true);
      if (end !== undefined) ir.temporal.end = end;
    }
    if (!ir.temporal.relative && ir.temporal.start === undefined && ir.temporal.end === undefined && nativeDirectives?.around) {
      const center = this.parseNativeDate(nativeDirectives.around, resolvedClock.timeZone);
      if (center !== undefined) {
        const [year, month, day] = this.civilParts(nativeDirectives.around);
        const start = nextCivilDate(year, month, day, -7, resolvedClock.timeZone);
        const end = nextCivilDate(year, month, day, 8, resolvedClock.timeZone);
        const range = localDateRange(...start, ...end, resolvedClock.timeZone);
        ir.temporal.start = range.from;
        ir.temporal.end = range.to;
      }
    }

    this.resolveProjectTemporalWindow(ir, effectiveQuery, resolvedClock, Boolean(nativeDirectives?.from || nativeDirectives?.to || nativeDirectives?.around));

    const entityResolution = this.entityResolutionEngine.resolve({ query: effectiveQuery, ir, projectId });
    return { ir, semanticCompilation, entityResolution };
  }

  private mapNativeTime(value: string): QueryIR['temporal']['relative'] | undefined {
    const lowered = value.toLowerCase();
    if (/halfyear|half-year|6m|six-months/.test(lowered)) return 'around_half_year_ago';
    if (/year|1y|12m/.test(lowered)) return 'past_year';
    if (/month|1m/.test(lowered)) return 'this_month';
    if (/week|1w/.test(lowered)) return 'this_week';
    if (/today|day|1d/.test(lowered)) return 'today';
    return undefined;
  }

  private parseNativeDate(value: string, timeZone: string, endExclusive: boolean = false): number | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    try {
      assertLocalDate(value, timeZone);
      const [year, month, day] = this.civilParts(value);
      const end = nextCivilDate(year, month, day, 1, timeZone);
      const range = localDateRange(year, month, day, ...end, timeZone);
      return endExclusive ? range.to : range.from;
    } catch {
      return undefined;
    }
  }

  private resolveProjectTemporalWindow(ir: QueryIR, query: string, clock: Pick<ProjectClockContext, 'localDateNow' | 'timeZone'>, hasNativeDateRange: boolean): void {
    if (hasNativeDateRange) return;
    const explicit = query.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (explicit) {
      const start = this.parseNativeDate(explicit, clock.timeZone);
      const end = this.parseNativeDate(explicit, clock.timeZone, true);
      if (start !== undefined && end !== undefined) ir.temporal = { start, end };
      return;
    }
    if (!ir.temporal.relative) return;
    const [year, month, day] = this.civilParts(clock.localDateNow);
    const range = (start: readonly [number, number, number], end: readonly [number, number, number]) => localDateRange(...start, ...end, clock.timeZone);
    const today = [year, month, day] as const;
    const tomorrow = nextCivilDate(year, month, day, 1, clock.timeZone);
    let resolved: { from: number; to: number } | undefined;
    switch (ir.temporal.relative) {
      case 'today': resolved = range(today, tomorrow); break;
      case 'yesterday': resolved = range(nextCivilDate(year, month, day, -1, clock.timeZone), today); break;
      case 'this_week': {
        const monday = nextCivilDate(year, month, day, -((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7), clock.timeZone);
        resolved = range(monday, nextCivilDate(...monday, 7, clock.timeZone));
        break;
      }
      case 'last_week': {
        const monday = nextCivilDate(year, month, day, -((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7), clock.timeZone);
        const previous = nextCivilDate(...monday, -7, clock.timeZone);
        resolved = range(previous, monday);
        break;
      }
      case 'this_month': resolved = range([year, month, 1], this.shiftMonth(year, month, 1)); break;
      case 'last_month': {
        const previous = this.shiftMonth(year, month, -1);
        resolved = range(previous, [year, month, 1]);
        break;
      }
      case 'this_year': resolved = range([year, 1, 1], [year + 1, 1, 1]); break;
      case 'last_year': resolved = range([year - 1, 1, 1], [year, 1, 1]); break;
      case 'past_six_months': resolved = range(this.shiftMonth(year, month, -6, day), tomorrow); break;
      case 'past_year': resolved = range(this.validPriorYearDate(year, month, day, clock.timeZone), tomorrow); break;
      case 'around_half_year_ago': {
        const center = this.shiftMonth(year, month, -6, day);
        resolved = range(nextCivilDate(...center, -7, clock.timeZone), nextCivilDate(...center, 8, clock.timeZone));
        break;
      }
    }
    if (resolved) ir.temporal = { start: resolved.from, end: resolved.to, relative: ir.temporal.relative };
  }

  private civilParts(value: string): [number, number, number] {
    return value.split('-').map(Number) as [number, number, number];
  }

  private shiftMonth(year: number, month: number, offset: number, preferredDay = 1): [number, number, number] {
    const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
    const targetYear = shifted.getUTCFullYear();
    const targetMonth = shifted.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return [targetYear, targetMonth, Math.min(preferredDay, lastDay)];
  }

  private validPriorYearDate(year: number, month: number, day: number, timeZone: string): [number, number, number] {
    let cursor = new Date(Date.UTC(year - 1, month - 1, day));
    for (let attempts = 0; attempts < 370; attempts += 1) {
      const candidate = [cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()] as [number, number, number];
      const value = candidate.map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
      try {
        assertLocalDate(value, timeZone);
        return candidate;
      } catch {
        cursor = new Date(Date.UTC(candidate[0], candidate[1] - 1, candidate[2] - 1));
      }
    }
    throw new Error(`unable_to_resolve_prior_year_date:${timeZone}`);
  }
}
