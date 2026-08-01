export const createTool = (def: {
  id?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  execute?: (...args: unknown[]) => unknown;
}) => ({
  id: def.id ?? 'mock-tool',
  description: def.description ?? '',
  inputSchema: def.inputSchema,
  outputSchema: def.outputSchema,
  execute: def.execute,
});
