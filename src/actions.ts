import type { Snapshot, GroundedAction } from './types.js';
import { BrowserError } from './errors.js';

export function actionCandidates(snapshot: Snapshot, values: Record<string, string>, limit: number): Map<string, GroundedAction> {
  const result = new Map<string, GroundedAction>();
  const add = (action: GroundedAction) => {
    if (result.size >= limit) throw new BrowserError('CANDIDATE_LIMIT', 'Too many action candidates. Narrow scope or raise maxCandidates.');
    result.set(`a${result.size}`, action);
  };
  for (const target of snapshot.elements) {
    if (target.disabled) continue;
    if (target.tag === 'select') {
      // Playwright cannot retain a disabled selected option without force. Do not clear it.
      if (target.multiple && target.options?.some(option => option.selected && option.disabled)) continue;
      for (const option of target.options ?? []) if (!option.disabled && (!option.selected || target.multiple))
        add({ kind: option.selected ? 'deselect' : 'select', target, option: { index: option.index, label: option.label, value: option.value } });
    } else if (['checkbox', 'radio', 'switch'].includes(target.role)) {
      if (typeof target.checked !== 'boolean') add({ kind: 'click', target });
      else if (!target.checked) add({ kind: 'check', target });
      else if (target.role !== 'radio') add({ kind: 'uncheck', target });
    } else if (target.fillable) {
      if (!target.readOnly) for (const valueKey of Object.keys(values)) add({ kind: 'fill', target, valueKey });
      add({ kind: 'press', target, key: 'Enter' });
    } else {
      add({ kind: 'click', target });
    }
  }
  if (snapshot.scroll.y < snapshot.scroll.maxY) add({ kind: 'scroll', direction: 'down' });
  if (snapshot.scroll.y > 0) add({ kind: 'scroll', direction: 'up' });
  return result;
}
/** Do not duplicate large option lists, DOM state, or literal input values in every choice. */
export function actionDescription(action: GroundedAction) {
  const target = action.target;
  return {
    kind: action.kind,
    ...(target ? { target: { id: modelElementId(target.id), role: target.role, name: target.name, context: target.context, frame: target.frame, filled: target.filled, checked: target.checked, ...(target.multiple ? { multiple: true } : {}) } } : {}),
    ...(action.valueKey !== undefined ? { valueKey: action.valueKey } : {}),
    ...(action.option ? { option: { label: action.option.label } } : {}),
    ...(action.key ? { key: action.key } : {}),
    ...(action.direction ? { direction: action.direction } : {}),
  };
}

/** Ephemeral public ref nonces are execution authority, not semantic model context. */
export const modelElementId = (id: string): string => id.replace(/^r[0-9a-f]+_/, '');
