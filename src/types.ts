import type { Page, LaunchOptions } from 'playwright';
import type { DecisionEngine, DecisionResult, JevOptions } from './decision.js';

export interface ElementInfo {
  id: string;
  frame: number;
  role: string;
  name: string;
  context: string;
  tag: string;
  inputType: string;
  disabled: boolean;
  readOnly: boolean;
  fillable: boolean;
  checked?: boolean | 'mixed';
  multiple?: boolean;
  filled?: boolean;
  options?: { index: number; label: string; value: string; selected: boolean; disabled: boolean }[];
}
export interface TextEvidence {
  role: string;
  id: string;
  frame: number;
  text: string;
  context: string;
  value?: boolean;
}
export interface Snapshot {
  id: string;
  url: string;
  title: string;
  elements: ElementInfo[];
  texts: TextEvidence[];
  truncated: boolean;
  truncatedElements: boolean;
  truncatedTexts: boolean;
  scroll: { y: number; maxY: number; height: number };
}
export type ActionKind = 'click' | 'fill' | 'check' | 'uncheck' | 'select' | 'deselect' | 'press' | 'scroll';
export interface GroundedAction {
  kind: ActionKind;
  target?: ElementInfo;
  valueKey?: string;
  option?: { index: number; label: string; value: string };
  key?: 'Enter';
  direction?: 'up' | 'down';
}
export interface ActionPlan {
  id: string;
  snapshotId: string;
  action: GroundedAction;
  confidence: number;
  decision: Omit<DecisionResult, 'answers'>;
}
export interface ActResult { status: 'executed'; plan: ActionPlan; url: string }
export interface OperationOptions { signal?: AbortSignal; scope?: string }
/** Remaining operation budget at callback entry. Awaited callbacks must honor signal. */
export interface OperationContext { readonly signal: AbortSignal; readonly timeoutMs: number }
export interface ActOptions extends OperationOptions { values?: Record<string, string> }
export interface RunOptions extends ActOptions {
  maxSteps?: number;
  /** Must be a read-only, deterministic check. True is the only verified completion. */
  until?: (page: Page, operation: OperationContext) => Promise<boolean> | boolean;
}
export interface RunResult {
  status: 'complete' | 'unverified' | 'stopped';
  reason: 'verified' | 'model-complete' | 'no-match' | 'step-limit';
  steps: ActResult[];
}
export interface BrowserOptions extends JevOptions {
  page: Page;
  engine?: DecisionEngine;
  maxElements?: number;
  maxTexts?: number;
  maxCandidates?: number;
  /** Deterministic authorization, independent of model confidence. */
  allowAction?: (plan: ActionPlan, operation: OperationContext) => boolean | Promise<boolean>;
}
export interface BrowserLaunchOptions extends Omit<BrowserOptions, 'page'> {
  headless?: boolean;
  launchOptions?: LaunchOptions;
}
export interface ExtractResult<T> {
  data: T;
  evidence: Record<string, TextEvidence & { copiedValue: string | number | boolean }>;
  snapshotId: string;
  decision?: Omit<DecisionResult, 'answers'>;
}
