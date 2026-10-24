import { RUNTIME_TOOL_CATALOG } from '@qitu/contracts';
import type { QituSDK } from '@qitu/ai-client';
import type { ModelRuntimeTool } from '@qitu/model-runtime';

type ReadSdk = Pick<QituSDK<unknown, unknown, unknown>, 'tools'>;

/** Bind only the two implemented, scoped SDK readers. Domain commands are never exposed. */
export async function tutorReadTools(sdk: ReadSdk, onRead: (toolId: string) => Promise<void>): Promise<ModelRuntimeTool[]> {
  const authorized = await sdk.tools.list();
  return RUNTIME_TOOL_CATALOG.filter(tool => tool.invocation === 'sdk_read'
    && authorized.some(entry => entry.id === tool.id)).flatMap(tool => tool.inputSchema ? [{
    name: tool.id,
    description: tool.id === 'mastery_query' ? '读取当前学生已有的知识掌握记录，不修改掌握度。'
      : '读取当前学生已有的成长与学情摘要，不包含其他学生的信息。',
    inputSchema: tool.inputSchema,
    execute: async (args, signal) => {
      if (signal?.aborted) return { text: 'TOOL_CANCELLED', isError: true };
      if (Object.keys(args).length) return { text: 'TOOL_ARGUMENT_INVALID', isError: true };
      try {
        // SDK re-reads live grants and frozen role pins, then checks the student's object scope.
        const result = await sdk.tools.call(tool.id, args);
        await onRead(tool.id);
        return { text: JSON.stringify(result) };
      } catch {
        return { text: 'LEARNER_READ_UNAVAILABLE', isError: true };
      }
    },
  } satisfies ModelRuntimeTool] : []);
}
