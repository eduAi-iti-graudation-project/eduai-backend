import { z } from 'zod';

interface ToolDefinition<TInput, TOutput> {
  id?: string;
  description?: string;
  inputSchema?: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  execute: (input: TInput) => Promise<TOutput>;
}

export function createTool<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>,
): { execute: (input: TInput) => Promise<TOutput> } {
  return {
    execute: def.execute,
  };
}
