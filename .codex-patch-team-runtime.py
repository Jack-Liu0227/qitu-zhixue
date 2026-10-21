from pathlib import Path

root = Path("/root/qitu-zhixue")


def patch(relative: str, replacements: list[tuple[str, str]]) -> None:
    path = root / relative
    text = path.read_text()
    for old, new in replacements:
        if old not in text:
            raise SystemExit(f"PATCH_TARGET_NOT_FOUND {relative}: {old[:100]!r}")
        text = text.replace(old, new, 1)
    path.write_text(text)
    print(f"patched {relative}")


patch(
    "packages/contracts/src/team-runtime.ts",
    [(
        """export interface PblPlanOutput {
  goal: string;
  stages: readonly {
    id: string;
    title: string;
    objective: string;
    taskIds: readonly string[];
  }[];
  requiresStudentConfirmation: boolean;
}

export interface PblAdvanceInput {""",
        """export interface PblPlanOutput {
  goal: string;
  stages: readonly {
    id: string;
    title: string;
    objective: string;
    taskIds: readonly string[];
  }[];
  requiresStudentConfirmation: boolean;
}

/**
 * Runtime routes store this schema so every Team Agent receives the same
 * bounded pbl.plan output contract before the worker validates it again.
 */
export const PBL_PLAN_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'stages', 'requiresStudentConfirmation'],
  properties: {
    goal: { type: 'string' },
    stages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'objective', 'taskIds'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          objective: { type: 'string' },
          taskIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    requiresStudentConfirmation: { type: 'boolean' },
  },
};

export interface PblAdvanceInput {""",
    )],
)

patch(
    "services/api/src/modules/platform-registry/team-version.runtime.ts",
    [
        (
            "import type { CurrentUser } from '@qitu/contracts';",
            "import { PBL_PLAN_OUTPUT_SCHEMA, type CurrentUser } from '@qitu/contracts';",
        ),
        (
            """    if (existing) {
      if (!existing.enabled) {
        await tx.update(agentRoutes).set({
          enabled: true,
          updatedBy: actorId,
          updatedAt: now,
        }).where(eq(agentRoutes.id, existing.id));
      }
      continue;
    }""",
            """    if (existing) {
      if (!existing.enabled || JSON.stringify(existing.outputSchema) !== JSON.stringify(PBL_PLAN_OUTPUT_SCHEMA)) {
        await tx.update(agentRoutes).set({
          enabled: true,
          outputSchema: PBL_PLAN_OUTPUT_SCHEMA,
          updatedBy: actorId,
          updatedAt: now,
        }).where(eq(agentRoutes.id, existing.id));
      }
      continue;
    }""",
        ),
        (
            """      trigger: 'delegate',
      taskType,
      enabled: true,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });""",
            """      trigger: 'delegate',
      taskType,
      enabled: true,
      outputSchema: PBL_PLAN_OUTPUT_SCHEMA,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });""",
        ),
    ],
)

patch(
    "services/workers/src/team-runtime-executor.ts",
    [
        (
            """  const candidate = text.trim().replace(/^```(?:json)?\\s*/iu, '').replace(/\\s*```$/u, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new TeamAgentExecutionError('TEAM_AGENT_OUTPUT_JSON_INVALID', '模型未返回合法 JSON');
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new TeamAgentExecutionError('TEAM_AGENT_OUTPUT_OBJECT_REQUIRED', '模型输出必须是 JSON object');
  }
  if (schema !== undefined && schema !== null) validateJsonSchema(parsed, schema);
  return parsed;
}
""",
            """  let parsed: Record<string, unknown> | null = null;
  for (const candidate of jsonObjectCandidates(text)) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isRecord(value) && !Array.isArray(value)) {
        parsed = value;
        break;
      }
    } catch {
      // Try the next balanced object when a model wrapped JSON in prose.
    }
  }
  if (parsed === null) {
    throw new TeamAgentExecutionError('TEAM_AGENT_OUTPUT_JSON_INVALID', '模型未返回合法 JSON');
  }
  if (schema !== undefined && schema !== null) validateJsonSchema(parsed, schema);
  return parsed;
}

function jsonObjectCandidates(text: string): string[] {
  const normalized = text.trim().replace(/^```(?:json)?\\s*/iu, '').replace(/\\s*```$/u, '').trim();
  const candidates = [normalized];
  for (let start = 0; start < normalized.length; start += 1) {
    if (normalized[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(normalized.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}
""",
        ),
        (
            "  const output = parseStructuredAgentOutput(result.text, route.outputSchema);",
            """  const output = await parseOrRepairStructuredOutput(runtime, {
    initialText: result.text,
    input: {
      usageId: `agent.${agent.id}`,
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(projection?.temperature !== undefined ? { temperature: projection.temperature } : {}),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      maxTokens: options.maxTokens ?? parsePositiveInt(options.env?.QITU_TEAM_RUNTIME_MAX_TOKENS) ?? DEFAULT_MAX_TOKENS,
      timeoutMs: options.timeoutMs ?? parsePositiveInt(options.env?.QITU_TEAM_RUNTIME_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
      requestId: `${job.message.runId}:${task.id}:${job.message.attempts}:repair`,
    },
    schema: route.outputSchema,
  });""",
        ),
        (
            """/** Fresh database reads keep worker routing in sync with administrator changes. */
export async function resolveTeamAgentModel(""",
            """async function parseOrRepairStructuredOutput(
  runtime: ReturnType<typeof createModelRuntime>,
  input: {
    initialText: string;
    input: Parameters<ReturnType<typeof createModelRuntime>['complete']>[0];
    schema?: Record<string, unknown> | null;
  },
): Promise<Record<string, unknown>> {
  try {
    return parseStructuredAgentOutput(input.initialText, input.schema);
  } catch (error) {
    if (!(error instanceof TeamAgentExecutionError)
      || !['TEAM_AGENT_OUTPUT_JSON_INVALID', 'TEAM_AGENT_OUTPUT_OBJECT_REQUIRED', 'TEAM_AGENT_OUTPUT_SCHEMA_MISMATCH'].includes(error.code)) {
      throw error;
    }
  }

  const schemaText = input.schema ? boundedJson(input.schema, MAX_INPUT_CHARS) : '{"type":"object"}';
  const repaired = await runtime.complete({
    ...input.input,
    messages: [
      {
        role: 'system',
        content: [
          '你是结构化输出转换器。',
          '只输出一个符合给定 JSON Schema 的 JSON object。',
          '不得添加解释、Markdown、代码围栏、前后缀或任何额外字段。',
          `输出 JSON Schema：${schemaText}`,
        ].join('\\n'),
      },
      {
        role: 'user',
        content: `请仅修复格式并保留原有语义：\\n${bounded(input.initialText, MAX_OUTPUT_CHARS)}`,
      },
    ],
  });
  return parseStructuredAgentOutput(repaired.text, input.schema);
}

/** Fresh database reads keep worker routing in sync with administrator changes. */
export async function resolveTeamAgentModel(""",
        ),
    ],
)

patch(
    "services/workers/src/team-runtime-executor.test.ts",
    [(
        """  assert.deepEqual(parseStructuredAgentOutput('{"confirmed":true}', schema), { confirmed: true });
  assert.throws(""",
        """  assert.deepEqual(parseStructuredAgentOutput('{"confirmed":true}', schema), { confirmed: true });
  assert.deepEqual(parseStructuredAgentOutput('格式说明：\\n{"confirmed":true}\\n以上为结果。', schema), { confirmed: true });
  assert.throws(""",
    )],
)

patch(
    "services/api/src/modules/platform-registry/team-version.runtime.test.ts",
    [
        (
            "import type { CurrentUser } from '@qitu/contracts';",
            "import { PBL_PLAN_OUTPUT_SCHEMA, type CurrentUser } from '@qitu/contracts';",
        ),
        (
            """  assert.equal(routes[0]?.taskType, 'pbl.plan');
  assert.equal(routes[0]?.enabled, true);
});""",
            """  assert.equal(routes[0]?.taskType, 'pbl.plan');
  assert.equal(routes[0]?.enabled, true);
  assert.deepEqual(routes[0]?.outputSchema, PBL_PLAN_OUTPUT_SCHEMA);
});""",
        ),
    ],
)
