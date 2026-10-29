import { z } from 'zod';
import { TOOL_SCHEMAS } from './schemas.js';

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.map(String).join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Validate and strip tool arguments. Throws ToolInputError; never includes the raw value. */
export function parseToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const schema = TOOL_SCHEMAS[name];
  if (!schema) return args;
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new ToolInputError(`Invalid arguments: ${formatZodError(parsed.error)}`);
  }
  if (typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
    throw new ToolInputError('Invalid arguments: expected an object');
  }
  return parsed.data as Record<string, unknown>;
}
