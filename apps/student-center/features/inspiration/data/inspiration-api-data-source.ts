import { ApiError } from '@qitu/api-client';
import type { CreateExplorationRequest, ExplorationView, TemplateStage } from '@qitu/contracts';
import type { InspirationDataSource } from './inspiration-data-source';
import type { InspirationDifficulty, InspirationTemplate } from '../types';

/**
 * 服务端 `domain` 枚举值的展示翻译（与教师端 CATEGORY_LABELS 同一模式）。
 * 未知枚举原样透出，绝不编造学科名。
 */
const DOMAIN_LABELS: Record<string, string> = {
  programming_game_dev: '游戏开发',
  programming: '编程',
  physics_mechanics: '物理力学',
  design: '设计',
  art: '艺术',
};

/** 服务端难度枚举 → 展示词。未知值返回 null（不显示，而不是编一个）。 */
function toDifficulty(value: unknown): InspirationDifficulty | null {
  if (value === 'beginner' || value === '入门') return '入门';
  if (value === 'intermediate' || value === '进阶') return '进阶';
  if (value === 'advanced' || value === '挑战') return '挑战';
  return null;
}

export class InspirationApiDataSource implements InspirationDataSource {
  async listTemplates(): Promise<InspirationTemplate[]> {
    // 学生端模板库只读接口优先；其余端点仅作兼容探测。
    const endpoints = ['/api/v1/project-templates', '/api/v1/admin/project-templates', '/api/v1/tutor/templates'];

    let lastError: ApiError | null = null;
    for (const endpoint of endpoints) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
      } catch {
        // 网络不可达：status 0 会被 useInspirationData 映射为 offline 状态。
        lastError = new ApiError('网络不可用', 0, 'NETWORK_OFFLINE');
        continue;
      }
      if (!response.ok) {
        lastError = new ApiError(`模板服务响应 ${response.status}`, response.status);
        continue;
      }
      const payload: unknown = await response.json().catch(() => null);
      const data = isRecord(payload) && 'data' in payload ? payload.data : payload;
      const list = Array.isArray(data)
        ? data
        : isRecord(data) && Array.isArray(data.templates)
          ? data.templates
          : null;
      if (!list) {
        lastError = new ApiError('模板服务响应格式异常', response.status, 'BAD_PAYLOAD');
        continue;
      }
      // 端点应答成功即为权威结果：空列表就是空列表（页面渲染空态），不再回退。
      return await this.toTemplates(list, endpoint);
    }

    // 所有端点都失败：按数据源错误约定抛出，由页面呈现 offline / permission / error 状态。
    throw lastError ?? new ApiError('模板服务不可用', 0, 'NETWORK_OFFLINE');
  }

  async createRecommendedExploration(
    request: CreateExplorationRequest,
    idempotencyKey: string,
  ): Promise<ExplorationView> {
    let response: Response;
    try {
      response = await fetch('/api/v1/explorations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new ApiError('网络不可用', 0, 'NETWORK_OFFLINE');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `探索创建失败（${response.status}）`;
      const code = isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`;
      throw new ApiError(detail, response.status, code);
    }
    const data: unknown = isRecord(payload) && 'data' in payload ? payload.data : payload;
    if (!isRecord(data) || typeof data.id !== 'string') {
      throw new ApiError('探索创建响应格式异常', response.status, 'BAD_EXPLORATION_PAYLOAD');
    }
    return data as unknown as ExplorationView;
  }

  /** 把服务端模板投影为展示模型；缺失字段留空，绝不编造内容。 */
  private async toTemplates(list: unknown[], endpoint: string): Promise<InspirationTemplate[]> {
    const items = list.filter(isRecord);
    const stagesById = await this.loadStages(items, endpoint);
    return items
      .filter((item) => typeof item.id === 'string' && typeof item.title === 'string')
      .map((item): InspirationTemplate => {
        const id = item.id as string;
        const difficulty = toDifficulty(item.difficulty);
        const minutes = typeof item.estimatedDurationMinutes === 'number' ? item.estimatedDurationMinutes : null;
        const domain = typeof item.domain === 'string' ? item.domain : null;
        return {
          id,
          title: item.title as string,
          summary: typeof item.summary === 'string' ? item.summary : '',
          templateVersionId: typeof item.latestPublishedVersionId === 'string' ? item.latestPublishedVersionId : null,
          subject: domain ? (DOMAIN_LABELS[domain] ?? domain) : '',
          tags: Array.isArray(item.learningObjectives)
            ? item.learningObjectives.filter((tag): tag is string => typeof tag === 'string')
            : [],
          difficulty,
          lessonCount: minutes !== null && minutes > 0 ? Math.max(1, Math.ceil(minutes / 60)) : null,
          lessonMinutes: minutes !== null && minutes > 0 && minutes % 120 === 0 ? 120 : minutes !== null && minutes > 0 ? 60 : null,
          stages: stagesById.get(id) ?? [],
          outcome: typeof item.outcomeForm === 'string' ? item.outcomeForm : '',
          iconAssetId: typeof item.iconAssetId === 'string' ? item.iconAssetId : null,
          coverAssetId: typeof item.coverAssetId === 'string' ? item.coverAssetId : null,
        };
      });
  }

  /**
   * 阶段明细逐字来自冻结模板版本（`GET .../versions/:versionId`），组件不设
   * 阶段名常量。列表端点不带 stages，这里按模板并行补拉；拉不到就留空。
   */
  private async loadStages(
    items: Record<string, unknown>[],
    endpoint: string,
  ): Promise<Map<string, TemplateStage[]>> {
    const result = new Map<string, TemplateStage[]>();
    await Promise.all(
      items.map(async (item) => {
        const id = typeof item.id === 'string' ? item.id : null;
        const versionId = typeof item.latestPublishedVersionId === 'string' ? item.latestPublishedVersionId : null;
        if (!id || !versionId || !endpoint.startsWith('/api/v1/project-templates')) return;
        try {
          const response = await fetch(
            `/api/v1/project-templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
            { credentials: 'same-origin', headers: { accept: 'application/json' } },
          );
          if (!response.ok) return;
          const payload: unknown = await response.json().catch(() => null);
          const data = isRecord(payload) && 'data' in payload ? payload.data : payload;
          const stages = isRecord(data) && Array.isArray(data.stages) ? data.stages : [];
          result.set(
            id,
            stages.filter(isRecord).flatMap((stage): TemplateStage[] =>
              typeof stage.id === 'string' && typeof stage.label === 'string'
                ? [{ id: stage.id, label: stage.label }]
                : [],
            ),
          );
        } catch {
          // 单个模板的阶段补拉失败不拖垮列表：该模板 stages 留空。
        }
      }),
    );
    return result;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
