import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRecommendationSignals, parseModelRecommendation, rankTemplateRecommendations } from './tutor.recommendation';
import type { TemplateView } from '../templates/templates.types';
import type { ExplorationView } from '@qitu/contracts';

const exploration = (interest: string, goal: string): ExplorationView => ({
  id: 'exp-1', source: 'free', templateVersionId: null, status: 'awaiting_confirmation',
  intentDraft: { id: 'draft-1', explorationId: 'exp-1', goalUser: goal, coreInterests: [interest], preferredForm: null, targetBeneficiary: null, confirmedAt: null, updatedAt: new Date().toISOString() },
  projectId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const template = (id: string, title: string, domain: string): TemplateView => ({
  id, schoolId: null, scope: 'platform', slug: id, title, summary: title, domain, ageRange: '12-15', difficulty: '入门',
  estimatedDurationMinutes: 300, requiredMaterials: [], learningObjectives: [title], outcomeForm: null, safetyNotes: null,
  status: 'published', latestPublishedVersionId: `${id}-v1`, createdAt: '', updatedAt: '',
});

test('意图关键词改变确定性 Top-N，证明不是固定取前三个', () => {
  const templates = [template('plant', '校园植物观察', '科学'), template('robot', '智能机器人设计', '工程'), template('story', '校园故事地图', '人文')];
  const plants = rankTemplateRecommendations(buildRecommendationSignals(exploration('植物', '观察植物生长'), ['叶片颜色']), templates);
  const robots = rankTemplateRecommendations(buildRecommendationSignals(exploration('机器人', '制作机器人'), ['传感器控制']), templates);
  assert.equal(plants[0]?.template.id, 'plant');
  assert.equal(robots[0]?.template.id, 'robot');
  assert.notDeepEqual(plants.map((item) => item.template.id), robots.map((item) => item.template.id));
});

test('意图未达到状态、目标和兴趣三项门槛时不推荐', () => {
  const incomplete = { ...exploration('植物', ''), status: 'exploring' as const };
  const signals = buildRecommendationSignals(incomplete, ['我喜欢科学']);
  assert.equal(signals.clarified, false);
  assert.deepEqual(rankTemplateRecommendations(signals, [template('plant', '植物观察', '科学')]), []);
});

test('模型结果只能排序候选，不接受伪造 ID、重复 ID 或非法 JSON', () => {
  const candidates = rankTemplateRecommendations(buildRecommendationSignals(exploration('植物', '观察植物'), []), [template('plant', '植物观察', '科学')]);
  assert.deepEqual(parseModelRecommendation('{"templateIds":["plant"]}', candidates), ['plant']);
  assert.equal(parseModelRecommendation('{"templateIds":["unpublished"]}', candidates), null);
  assert.equal(parseModelRecommendation('{"templateIds":["plant","plant"]}', candidates), null);
  assert.equal(parseModelRecommendation('no json', candidates), null);
});
