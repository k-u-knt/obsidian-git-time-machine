import type { SpatialAdapter } from "./types";

export interface Fixup {
  id: string;
  reason: string;
}

/** What a region restore will do. Ids cover both items and connectors. */
export interface RestorePlan {
  /** Exist now, restored to their past content. */
  replace: string[];
  /** Missing now, brought back from the past. */
  add: string[];
  /** Only with `removeAdded`: items added since then inside the region, and connectors attached to them. */
  remove: string[];
  /** Selected but unchanged. */
  skip: string[];
  /** Past connectors left out because one end won't exist. */
  fixups: Fixup[];
  /** Vault files a restored item needs that are missing now. */
  extraFiles: string[];
  warnings: string[];
}

export interface PlanInput {
  past: SpatialAdapter;
  current: SpatialAdapter;
  /** Past item ids, already expanded. */
  selected: string[];
  /** True when the item or connector is identical in both versions (content and position). */
  unchanged(id: string): boolean;
  /** Current items inside the region; used only with `removeAdded`. */
  currentInRegion: string[];
  removeAdded: boolean;
  fileExists(path: string): boolean;
  /** For messages. */
  title(id: string): string;
}

export function planRestore(input: PlanInput): RestorePlan {
  const { past, current } = input;
  const plan: RestorePlan = { replace: [], add: [], remove: [], skip: [], fixups: [], extraFiles: [], warnings: [] };
  const selected = new Set(input.selected);
  const classify = (id: string) => {
    if (!current.has(id)) plan.add.push(id);
    else if (input.unchanged(id)) plan.skip.push(id);
    else plan.replace.push(id);
  };
  for (const id of input.selected) classify(id);

  const removed = new Set<string>();
  if (input.removeAdded) {
    for (const id of input.currentInRegion) {
      if (!past.has(id) && !selected.has(id)) removed.add(id);
    }
  }

  const willExist = (id: string) => selected.has(id) || (current.has(id) && !removed.has(id));
  const currentConnectors = new Set(current.connectors().map((c) => c.id));
  for (const c of past.connectors()) {
    if (!selected.has(c.from) && !selected.has(c.to)) continue;
    if (willExist(c.from) && willExist(c.to)) classify(c.id);
    else if (!currentConnectors.has(c.id)) {
      plan.fixups.push({ id: c.id, reason: `Left out a connection to "${input.title(selected.has(c.from) ? c.to : c.from)}", which no longer exists.` });
    }
  }
  for (const c of current.connectors()) {
    if (removed.has(c.from) || removed.has(c.to)) removed.add(c.id);
  }
  plan.remove = [...removed];

  const files = new Set<string>();
  for (const id of [...plan.add, ...plan.replace]) {
    for (const f of past.filesNeeded(id)) if (!input.fileExists(f)) files.add(f);
  }
  plan.extraFiles = [...files];
  for (const f of plan.extraFiles) plan.warnings.push(`"${f}" was deleted since then and will be restored too.`);
  for (const fx of plan.fixups) plan.warnings.push(fx.reason);
  return plan;
}

/** "Restore 7 items: 3 replace current versions · 2 come back · 2 unchanged". */
export function describePlan(plan: RestorePlan): string {
  const parts: string[] = [];
  if (plan.replace.length) parts.push(`${plan.replace.length} replace${plan.replace.length === 1 ? "s" : ""} the current version`);
  if (plan.add.length) parts.push(`${plan.add.length} come${plan.add.length === 1 ? "s" : ""} back`);
  if (plan.remove.length) parts.push(`${plan.remove.length} added since then will be removed`);
  if (plan.skip.length) parts.push(`${plan.skip.length} unchanged`);
  const total = plan.replace.length + plan.add.length + plan.skip.length;
  if (!plan.replace.length && !plan.add.length && !plan.remove.length) return total ? "Nothing to restore here: the selection is unchanged." : "Nothing selected.";
  return `Restore ${total} item${total === 1 ? "" : "s"}: ${parts.join(" · ")}`;
}
