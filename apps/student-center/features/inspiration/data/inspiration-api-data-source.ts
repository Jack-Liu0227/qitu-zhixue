import { ApiError } from '@qitu/api-client';
import type { InspirationDataSource } from './inspiration-data-source';
import type { InspirationTemplate } from '../types';

export class InspirationApiDataSource implements InspirationDataSource {
  async listTemplates(): Promise<InspirationTemplate[]> {
    let response: Response;
    try {
      response = await fetch('/api/v1/tutor/templates', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new ApiError('网络不可用', 0, 'NETWORK_OFFLINE');
    }
    if (!response.ok) {
      throw new ApiError('灵感模板加载失败', response.status, `HTTP_${response.status}`);
    }
    const payload: unknown = await response.json();
    const data = isRecord(payload) && 'data' in payload ? payload.data : payload;
    if (!isRecord(data) || !Array.isArray(data.templates)) {
      throw new ApiError('灵感模板数据格式不正确', 502, 'BAD_TEMPLATE_PAYLOAD');
    }
    return data.templates.filter(isInspirationTemplate);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInspirationTemplate(value: unknown): value is InspirationTemplate {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.summary === 'string'
    && typeof value.subject === 'string'
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === 'string')
    && (value.difficulty === '入门' || value.difficulty === '进阶' || value.difficulty === '挑战')
    && typeof value.durationWeeks === 'number'
    && Array.isArray(value.stages)
    && typeof value.outcome === 'string';
}
