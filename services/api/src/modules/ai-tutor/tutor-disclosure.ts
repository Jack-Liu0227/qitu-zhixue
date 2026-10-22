import type { PendingQuestionRecord } from '../learning-plan/learning-plan.store';
import { dynamicQuestionEnvelope } from '../learning-plan/question-candidate';

export type TutorDisclosure =
  | { kind: 'instruction' }
  | { kind: 'pending_assessment'; questionId: string; prompt: string;
      options: { id: string; label: string; body: string }[]; protectedTexts: string[] };

/** Private keys remain in the server guard. Only public prompt/options enter model context. */
export function pendingDisclosure(question: PendingQuestionRecord): TutorDisclosure {
  const key = question.assessmentType === 'formative' ? dynamicQuestionEnvelope(question).correctOptionId : question.expectedAnswer;
  const correct = question.options.find(option => option.id === key || option.body === key || option.label === key);
  return { kind: 'pending_assessment', questionId: question.id, prompt: question.prompt, options: question.options,
    protectedTexts: [key, correct?.body ?? key, question.explanation].filter(text => text.trim().length > 0) };
}

export function disclosurePrompt(disclosure: TutorDisclosure): string {
  return disclosure.kind === 'instruction'
    ? '本轮为教学讲解：默认学生零基础，先用通俗比喻与生动生活现象讲解定性机理，再结合公式、图表或动态课件给出清晰结论；不要用空洞反问代替必要解释。AI 示例不代表学生掌握或作品通过。'
    : `本轮存在尚未提交的题目。允许解释先备概念、给线索或不同题的示例；不得代选选项、完成当前题、输出私有答案或解析。求助不作判错，不替换当前题。公开题目：${JSON.stringify({ questionId: disclosure.questionId, prompt: disclosure.prompt, options: disclosure.options })}`;
}

export function leaksPendingAnswer(text: string, disclosure: TutorDisclosure): boolean {
  if (disclosure.kind !== 'pending_assessment') return false;
  if (/(?:正确|标准)?答案(?:是|就是|为)|(?:选|选择|勾选|填|填入)\s*(?:[A-FＡ-Ｆ1-6]|第[1-6一二三四五六])(?:个|项|就|吧|[。.!！\s]|$)|[A-FＡ-Ｆ1-6一二三四五六](?:项|选项)?\s*(?:是|为)(?:正确|答案)|(?:正确|应选|选项)\s*[:：]?\s*[A-FＡ-Ｆ1-6](?:项|[。.!！\s]|$)/iu.test(text)) return true;
  const normalized = text.replace(/\s+/gu, '').toLocaleLowerCase();
  return disclosure.protectedTexts.some(value => {
    const answer = value.replace(/\s+/gu, '').toLocaleLowerCase();
    if (answer.length >= 4) return normalized.includes(answer);
    return normalized === answer || ['=', ':', '\uFF1A', '\u4E3A', '\u7B49\u4E8E'].some(prefix => normalized.includes(prefix + answer));
  });
}
