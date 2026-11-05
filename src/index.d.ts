export interface FeedbackEntry {
  signal: 'up' | 'down' | string;
  context?: string;
  tags?: string[];
  toolName?: string;
  command?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface FeedbackSummaryResult {
  total: number;
  positive: number;
  negative: number;
  approvalRate: number;
  [key: string]: unknown;
}

export interface EnforcementRule {
  id: string;
  pattern: string;
  action: 'ALLOW' | 'WARN' | 'DENY';
  confidence?: number;
  reason?: string;
  [key: string]: unknown;
}

export function captureFeedback(input: FeedbackEntry): Record<string, unknown>;
export function emitAnonymousFeedbackPing(payload?: Record<string, unknown>): void;
export function buildFeedbackSourceIdentity(options?: Record<string, unknown>): Record<string, unknown>;
export function compactMemories(options?: Record<string, unknown>): Record<string, unknown>;
export function buildCorrectiveActionsReminder(options?: Record<string, unknown>): string;
export function analyzeFeedback(entries?: FeedbackEntry[]): Record<string, unknown>;
export function buildPreventionRules(options?: Record<string, unknown>): string;
export function writePreventionRules(options?: Record<string, unknown>): string;
export function feedbackSummary(options?: Record<string, unknown>): FeedbackSummaryResult;
export function listEnforcementMatrix(options?: Record<string, unknown>): EnforcementRule[];
export function readJSONL<T = Record<string, unknown>>(filePath: string): T[];
export function appendDiagnosticRecord(record: Record<string, unknown>, options?: Record<string, unknown>): void;
export function readDiagnosticEntries(options?: Record<string, unknown>): Record<string, unknown>[];
export function getFeedbackPaths(options?: Record<string, unknown>): {
  FEEDBACK_DIR: string;
  FEEDBACK_LOG_PATH: string;
  DIAGNOSTIC_LOG_PATH: string;
  MEMORY_LOG_PATH: string;
  SUMMARY_PATH: string;
  PREVENTION_RULES_PATH: string;
};
export function inferDomain(context?: string, tags?: string[]): string;
export function inferOutcome(signal: string, context?: string): string;
export function enrichFeedbackContext(input: Record<string, unknown>): Record<string, unknown>;
export function inferLessonFromConversation(input: Record<string, unknown>): string;
export function updateStatuslineWithLesson(lesson: string, options?: Record<string, unknown>): void;
export function waitForBackgroundSideEffects(timeoutMs?: number): Promise<void>;
export function getPendingBackgroundSideEffectCount(): number;
export function isSelfHarnessOptimizerEnabled(env?: NodeJS.ProcessEnv): boolean;

export const FEEDBACK_LOG_PATH: string;
export const DIAGNOSTIC_LOG_PATH: string;
export const MEMORY_LOG_PATH: string;
export const SUMMARY_PATH: string;
export const PREVENTION_RULES_PATH: string;

export class HermesPlatformProtocol {
  constructor(options?: Record<string, unknown>);
  [key: string]: unknown;
}

export class HermesSyncPlane {
  constructor(options?: Record<string, unknown>);
  [key: string]: unknown;
}

export class ProtocolError extends Error {
  code?: string;
  constructor(message: string, code?: string);
}

export const CONSEQUENTIAL_ACTIONS: ReadonlyArray<string>;
export const VALID_APPROVAL_SURFACES: ReadonlyArray<string>;
export const INVALID_APPROVAL_SURFACES: ReadonlyArray<string>;
export const THREAD_MODES: Record<string, string>;
export const FORBIDDEN_IDENTITIES: ReadonlyArray<string>;
export function isNamedIdentity(identity: unknown): boolean;

export class IdeaBrowserConnector {
  constructor(options?: Record<string, unknown>);
  [key: string]: unknown;
}

export const ToolTier: Record<string, string>;
export const DEFAULT_READ_ONLY_TOOLS: ReadonlyArray<string>;
export const DEFAULT_MUTATING_TOOLS: ReadonlyArray<string>;
