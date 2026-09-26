'use client';

import { useState } from 'react';
import { SectionCard } from '@qitu/ui';
import { useTheorySubmit } from '../hooks/useProjectsMutations';
import type { TheoryAnswer, TheoryQuestion } from '../types';

export interface TheoryCheckProps {
  projectId: string;
  questions: TheoryQuestion[];
  /** 服务端已判定掌握时禁用重复提交。 */
  mastered?: boolean;
  /** 断网时禁用提交，但保留已选答案。 */
  offline?: boolean;
  /** 提交后以服务端返回的 theoryMastered 为准（验收 10）。 */
  onMastered?: (mastered: boolean) => void;
}

/**
 * 理论学习校验。选答是输入，判分只认服务端响应；
 * 客户端不做任何自判，也不写阶段状态。
 */
export function TheoryCheck({
  projectId,
  questions,
  mastered = false,
  offline = false,
  onMastered,
}: TheoryCheckProps) {
  const { mutate, pending, error, result } = useTheorySubmit(projectId);
  const [selected, setSelected] = useState<Record<string, number>>({});

  const canSubmit =
    !pending &&
    !mastered &&
    !offline &&
    questions.every((question) => selected[question.id] !== undefined);

  const handleSubmit = async (): Promise<void> => {
    const answers: TheoryAnswer[] = questions
      .filter((question) => selected[question.id] !== undefined)
      .map((question) => ({
        questionId: question.id,
        optionIndex: selected[question.id] ?? 0,
      }));
    const response = await mutate(answers);
    if (response) onMastered?.(response.theoryMastered);
  };

  return (
    <SectionCard title="理论校验">
      <ol className="qitu-theory-check" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {questions.map((question) => (
          <li key={question.id} className="qitu-theory-question">
            <p>{question.prompt}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {question.options.map((option, index) => (
                <li key={`${question.id}-${index}`}>
                  <label>
                    <input
                      type="radio"
                      name={question.id}
                      checked={selected[question.id] === index}
                      disabled={mastered || offline}
                      onChange={() =>
                        setSelected((current) => ({ ...current, [question.id]: index }))
                      }
                    />
                    <span>{option}</span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {error ? <p className="qitu-form-error">提交失败：{error.message}</p> : null}
      {result ? (
        <p className={result.passed ? 'qitu-form-success' : 'qitu-form-hint'}>
          {result.passed ? '理论已掌握，实践阶段已解锁。' : '还没有达到掌握标准，可以再看看材料。'}
        </p>
      ) : null}

      <button
        type="button"
        className="qitu-button qitu-button-primary"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {mastered ? '已通过' : pending ? '提交中…' : '提交校验'}
      </button>
    </SectionCard>
  );
}
