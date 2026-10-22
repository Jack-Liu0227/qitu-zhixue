import type { BuildQuestionInput, QuestionCard } from './index.js';

/** Server-private prerequisite checks. No geometric-optics or practice mastery is inferred. */
export function buildWaveReadinessQuestion(input: BuildQuestionInput): QuestionCard | null {
  const concept = input.objective.conceptId;
  if (!concept || !['wave.readiness.superposition', 'wave.readiness.coherence', 'wave.readiness.comparison'].includes(concept)) return null;
  if (!Number.isSafeInteger(input.index) || input.index < 0) throw new RangeError('Invalid question index');
  let hash = 2166136261;
  for (const c of `${input.seed ?? input.objective.id}:${input.index}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const amplitude = hash % 4 + 1;
  const opposite = input.index % 2 === 1;
  const superposition = {
    prompt: `用示意波理解叠加：两列同频波在某点的波幅大小都是 ${amplitude} 个示意单位，方向${opposite ? '相反' : '相同'}。该点合成波幅如何？这里讨论波幅，不是光强。`,
    answer: opposite ? '合成波幅为 0 个示意单位' : `合成波幅为 ${amplitude * 2} 个示意单位`,
    choices: [`合成波幅为 ${amplitude * 2} 个示意单位`, '合成波幅为 0 个示意单位', `合成波幅为 ${amplitude} 个示意单位`, '光强变成负数'],
    explanation: '示意波幅按方向叠加。同向相加，反向相减；波幅与光强不是同一个量，不能得到负光强。',
  };
  const coherence = {
    prompt: '在本课的等幅、同频、相同偏振示意模型中，哪一组条件能保持稳定的明暗条纹？',
    answer: '两列波保持稳定的相位差',
    choices: ['两列波保持稳定的相位差', '两列波的相位差随机变化', '只要是任意两个独立灯泡即可', '只增加亮度，不考虑相位关系'],
    explanation: '本模型需要稳定的相位关系。任意独立光源不保证相干，增加亮度不能代替相干条件。',
  };
  const comparison = {
    prompt: '要检验缝间距 d 对双缝条纹的影响，哪种模拟比较能支持这个判断？',
    answer: '只改变 d，保持波长、缝宽和屏距不变，并保存两次参数与观察',
    choices: ['只改变 d，保持波长、缝宽和屏距不变，并保存两次参数与观察', '同时改变全部参数，只比较最后一张图', '把模拟计算值直接标成真实测量', '只说图样好看，不保留参数与观察'],
    explanation: '受控比较一次只改变目标变量，并保存可追溯的条件与观察。模拟结果需要标明来源，不能称为真实测量。',
  };
  const task = concept === 'wave.readiness.superposition' ? superposition : concept === 'wave.readiness.coherence' ? coherence : comparison;
  const offset = hash % task.choices.length;
  const shuffled = [...task.choices.slice(offset), ...task.choices.slice(0, offset)];
  return {
    questionId: `q-${input.objective.id}-${input.index}`, objectiveId: input.objective.id,
    prompt: task.prompt, questionType: 'choice', expectedAnswer: task.answer,
    options: shuffled.map((body, index) => ({ id: `${input.objective.id}:option:${input.index}:${index}`, label: String.fromCharCode(65 + index), body })),
    explanation: task.explanation, difficulty: 'easy', keywords: [],
  };
}
