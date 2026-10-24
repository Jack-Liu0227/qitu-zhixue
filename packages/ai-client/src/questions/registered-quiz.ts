import { QUIZ_BANK } from '../quiz-bank/index.js';
import type { BuildQuestionInput, QuestionCard } from './index.js';

/** Formal concepts use registered questions, never synthetic spelling distractors. */
export function buildRegisteredQuizQuestion(input: BuildQuestionInput): QuestionCard | null {
  const entries = QUIZ_BANK.filter(entry => entry.conceptId === input.objective.conceptId);
  if (!entries.length) return null;
  if (!Number.isSafeInteger(input.index) || input.index < 0) throw new RangeError('Invalid question index');
  const entry = entries[input.index % entries.length]!;
  const correct = entry.options.find(option => entry.expectedKeys.includes(option.key));
  if (entry.expectedKeys.length !== 1 || !correct) throw new Error('Registered question requires one valid answer');
  let hash = 2166136261;
  for (const character of `${input.seed ?? input.objective.id}:${input.index}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  const offset = hash % entry.options.length;
  const options = [...entry.options.slice(offset), ...entry.options.slice(0, offset)];
  return {
    questionId: `q-${input.objective.id}-${input.index}`, objectiveId: input.objective.id,
    prompt: entry.stem, questionType: 'choice', expectedAnswer: correct.text,
    options: options.map((option, index) => ({ id: `${input.objective.id}:option:${input.index}:${index}`,
      label: String.fromCharCode(65 + index), body: option.text })),
    explanation: entry.explanation, difficulty: entry.difficulty, keywords: [],
  };
}
