// Types for thumbgate/adapters/claude-agent-sdk. The hooks object fits Options['hooks'] in @anthropic-ai/claude-agent-sdk.
export interface ThumbgateHookOptions {
  /** Tool-name matcher, e.g. "Bash|Write". All tools when left out. */
  matcher?: string;
  /** What to do with instruction-like text in tool output. Default "warn". */
  injection?: 'warn' | 'strip' | 'off';
  /** Redact secrets from tool output. Default true. */
  secrets?: boolean;
  /** Add the PostToolUse hook. Default true. */
  post?: boolean;
}

type HookCallback = (input: any, toolUseID?: string, context?: { signal?: AbortSignal }) => Promise<Record<string, any>>;
interface HookCallbackMatcher { matcher?: string; hooks: HookCallback[] }

export function thumbgateHooks(options?: ThumbgateHookOptions): {
  PreToolUse: HookCallbackMatcher[];
  PostToolUse?: HookCallbackMatcher[];
};
export const preToolUse: HookCallback;
export function postToolUseFor(options?: ThumbgateHookOptions): HookCallback;
export function scrubToolResponse(response: unknown, options?: ThumbgateHookOptions): {
  output: unknown; changed: boolean; secrets: number; injections: string[];
};
export function findInjection(text: string): string[];
export function stripInjection(text: string): string;
export const INJECTION_PATTERNS: RegExp[];
