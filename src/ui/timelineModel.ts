import type { Version } from "../history/types";

export interface TimelineEntry {
  /** "now" for the live file, otherwise the commit hash. */
  key: string;
  /** null for the live file. */
  version: Version | null;
  isNow: boolean;
  time: Date;
  /** Lines added + removed; drives tick height. */
  size: number;
}

export interface DayGroup {
  label: string;
  entries: TimelineEntry[];
}

export interface TimelineModel {
  entries: TimelineEntry[];
  groups: DayGroup[];
  maxSize: number;
}

/** Merges a freshly fetched page into the loaded list: no duplicate hashes, newest first. */
export function mergeVersions(existing: Version[], incoming: Version[]): Version[] {
  const byHash = new Map<string, Version>();
  for (const v of [...incoming, ...existing]) if (!byHash.has(v.hash)) byHash.set(v.hash, v);
  return [...byHash.values()].sort((a, b) => b.time.getTime() - a.time.getTime());
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function dayLabel(d: Date, now: Date, locale?: string): string {
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return new Intl.DateTimeFormat(locale, opts).format(d).replace(/,/g, "");
}

export function timeLabel(d: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/**
 * Builds the rail. When the live file equals the newest commit, that commit is shown as "Now"
 * instead of adding a separate live entry.
 */
export function buildTimeline(versions: Version[], opts: { now: Date; liveDiffersFromLatest: boolean; locale?: string }): TimelineModel {
  const entries: TimelineEntry[] = [];
  if (opts.liveDiffersFromLatest || versions.length === 0) {
    entries.push({ key: "now", version: null, isNow: true, time: opts.now, size: 0 });
  }
  versions.forEach((v, i) => {
    const mergedNow = i === 0 && !opts.liveDiffersFromLatest;
    entries.push({ key: v.hash, version: v, isNow: mergedNow, time: v.time, size: v.added + v.removed });
  });
  const groups: DayGroup[] = [];
  for (const e of entries) {
    const label = dayLabel(e.time, opts.now, opts.locale);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(e);
    else groups.push({ label, entries: [e] });
  }
  return { entries, groups, maxSize: Math.max(1, ...entries.map((e) => e.size)) };
}
