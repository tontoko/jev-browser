import type { Page, LaunchOptions, BrowserContextOptions } from 'playwright';
import type { NativeCommand } from './native-schemas.js';
import type { DecisionEngine, DecisionResult, JevOptions } from './decision.js';

export interface ElementInfo {
  id: string;
  frame: number;
  role: string;
  name: string;
  context: string;
  tag: string;
  inputType: string;
  fieldName?: string;
  formId?: string;
  formName?: string;
  popup?: string;
  controls?: string[];
  expanded?: boolean;
  listboxId?: string;
  required?: boolean;
  disabled: boolean;
  readOnly: boolean;
  fillable: boolean;
  checked?: boolean | 'mixed';
  multiple?: boolean;
  filled?: boolean;
  options?: { index: number; label: string; value: string; selected: boolean; disabled: boolean }[];
}
export interface TextEvidence {
  attribute?: string;
  role: string;
  id: string;
  frame: number;
  text: string;
  context: string;
  value?: boolean;
}
export interface RecordEvidence { id: string; frame: number; context: string; textIds: string[]; parentId?: string; readOnly?: boolean }
export interface Snapshot {
  records?: RecordEvidence[];
  recordInventoryComplete?: boolean;
  busy?: boolean;
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
export type ActionKind = 'click' | 'fill' | 'check' | 'uncheck' | 'select' | 'deselect' | 'press' | 'scroll' | 'hover' | 'dialog';
export interface GroundedAction {
  kind: ActionKind;
  target?: ElementInfo;
  valueKey?: string;
  option?: { index: number; label: string; value: string };
  optionIndices?: number[];
  /** Internal staged choice; resolved to an observed option before execution. */
  deferred?: boolean;
  /** The actual combobox ref whose declared popup owns an option action. */
  ownerId?: string;
  dialog?: BrowserDialog;
  accept?: boolean;
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
export interface BrowserDialog { id: number; type: string; message: string; defaultValue: string }
export interface ActResult { status: 'executed' | 'dialog'; plan: ActionPlan; url: string; dialog?: BrowserDialog }
export interface OperationOptions { signal?: AbortSignal; scope?: string; timeoutMs?: number }
export interface SemanticLocateOptions extends OperationOptions { minConfidence?: number }
export interface SemanticEvidence { sourceId: string; frame: number; role: string; text: string; context: string; attribute?: string; value?: string | number | boolean }
export interface SemanticTarget { ref: string; snapshotId: string; confidence: number; evidence: SemanticEvidence }
export type SemanticChoice = 'equivalent' | 'different' | 'insufficient_evidence';
export type SemanticAssertionStatus = 'passed' | 'failed' | 'inconclusive';
export type SemanticActual = SemanticTarget | { description: string } | { ref: string };
export interface SemanticComparisonRequest { actual: SemanticActual; expected: string; minConfidence?: number; minSourceConfidence?: number }
export interface SemanticCompareOptions extends OperationOptions { minConfidence?: number; minSourceConfidence?: number }
export interface SemanticUsage { requests: number; questions: number; serialDecisionDepth: number; inputTokens: number; outputTokens: number; providerMs: number; observationMs: number; verificationMs: number }
export interface SemanticComparisonResult { status: SemanticAssertionStatus; choice: SemanticChoice; confidence: number; sourceConfidence: number; threshold: number; sourceThreshold: number; source: 'deterministic' | 'semantic'; evidence: SemanticEvidence; model?: string; usage: SemanticUsage }
export interface ExtractOptions extends OperationOptions { recordsScope?: string }
/** Remaining operation budget at callback entry. Awaited callbacks must honor signal. */
export interface OperationContext { readonly signal: AbortSignal; readonly timeoutMs: number }
export interface ActOptions extends OperationOptions { values?: Record<string, string> }
export type RunValue = string | number | boolean | null | RunValue[] | { [key: string]: RunValue };
export type RunAssertion = Omit<Extract<NativeCommand, { command: 'assert' }>, 'command'>;
export interface RunOptions extends OperationOptions {
  values?: Record<string, RunValue>;
  expect?: RunAssertion | RunAssertion[];
  maxSteps?: number;
  maxDecisions?: number;
  /** Read-only provider retries per logical decision, 0..2. Browser effects are never replayed. */
  decisionRetries?: number;
  settleTimeoutMs?: number;
  /** Must be a read-only, deterministic check. True is the only verified completion. */
  until?: (page: Page, operation: OperationContext) => Promise<boolean> | boolean;
}
export interface RunInput { path: string; applied: boolean; readback: boolean; target?: string }
export interface RunEffect { id: string; kind: 'input' | 'advance' | 'commit'; status: 'attempted' | 'observed' | 'unknown'; input?: string }
export interface RunVerification { source: 'caller' | 'inferred'; basis: 'ui-readback' | 'assertion' | 'condition'; recordId?: string; readback: string[]; unobserved: string[] }
export interface RunResult {
  regions?: {purpose:'act'|'readback';name:string;role:string;frame:number}[];
  inputs?: RunInput[];
  effects?: RunEffect[];
  verification?: RunVerification;
  usage?: { requests: number; questions: number; serialDecisionDepth: number; inputTokens: number; outputTokens: number; providerMs: number };
  status: 'complete' | 'unverified' | 'stopped';
  reason: 'verified' | 'ui-readback' | 'model-complete' | 'no-match' | 'step-limit' | 'dialog' | 'ambiguous' | 'missing-input' | 'permission-required' | 'validation' | 'value-mismatch' | 'effect-unknown' | 'error' | 'observation-limit' | 'condition-unmet';
  steps: ActResult[];
}
export interface BrowserOptions extends JevOptions {
  page: Page;
  fileRoots?: string[];
  outputDir?: string;
  allowEvaluate?: boolean;
  allowCommand?: (command: NativeCommand, operation: OperationContext) => boolean | Promise<boolean>;
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
  browser?: 'chromium' | 'firefox' | 'webkit';
  contextOptions?: BrowserContextOptions;
  storageState?: BrowserContextOptions['storageState'];
  userDataDir?: string;
  cdpEndpoint?: string;
  wsEndpoint?: string;
}
export interface ExtractResult<T> {
  data: T;
  evidence: Record<string, TextEvidence & { copiedValue: string | number | boolean }>;
  snapshotId: string;
  decision?: Omit<DecisionResult, 'answers'>;
  decisions?: Omit<DecisionResult, 'answers'>[];
}
