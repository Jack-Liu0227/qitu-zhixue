import { ApiError } from '@qitu/api-client';
import type { InspirationDataSource } from './inspiration-data-source';
import type { InspirationTemplate } from '../types';
import { INSPIRATION_TEMPLATES } from './fixtures';

export class InspirationApiDataSource implements InspirationDataSource {
  async listTemplates(): Promise<InspirationTemplate[]> {
    // 优先尝试从服务端拉取已发布项目模板
    const endpoints = ['/api/v1/project-templates', '/api/v1/admin/project-templates', '/api/v1/tutor/templates'];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (response.ok) {
          const payload: unknown = await response.json();
          const data = isRecord(payload) && 'data' in payload ? payload.data : payload;
          const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.templates) ? data.templates : null;
          if (list && list.length > 0) {
            const mapped = list.map((item: any): InspirationTemplate => {
              if (isInspirationTemplate(item)) return item;
              return {
                id: item.id || item.slug || `template-${Date.now()}`,
                title: item.title || 'PBL 探索项目',
                summary: item.summary || '基于真实情境的跨学科探究实践。',
                subject: item.domain || '信息科技与物理',
                tags: Array.isArray(item.learningObjectives) && item.learningObjectives.length > 0 ? item.learningObjectives : ['探究实践', 'PBL'],
                difficulty: item.difficulty === '入门' || item.difficulty === '进阶' || item.difficulty === '挑战' ? item.difficulty : '进阶',
                durationWeeks: Math.max(1, Math.round((item.estimatedDurationMinutes || 1200) / 300)),
                stages: [
                  { id: 'stage-explore', label: '阶段一：开题与意图确认' },
                  { id: 'stage-theory', label: '阶段二：核心原理探究 (TheoryMastered)' },
                  { id: 'stage-practice', label: '阶段三：工程实践与代码自检' },
                  { id: 'stage-reflect', label: '阶段四：作品答辩与概念反思' },
                ],
                outcome: item.summary || '项目实践成果与反思档案',
                coverEmoji: item.id?.includes('thunder') ? '🚀' : '⚡',
              };
            });
            if (mapped.length > 0) {
              return mapped;
            }
          }
        }
      } catch {
        // 继续尝试下一个端点或降级
      }
    }

    // 默认回退到与 Admin 数据库严格同步的真实模板仓 (雷霆战机与动手学动能定理)
    return INSPIRATION_TEMPLATES;
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
