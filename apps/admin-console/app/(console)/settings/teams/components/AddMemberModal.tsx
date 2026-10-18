'use client';

import { useState } from 'react';
import type { AdminAssistantConfig } from '@qitu/contracts';

interface AddMemberModalProps {
  isOpen: boolean;
  allAssistants: AdminAssistantConfig[];
  existingMemberIds: string[];
  onClose: () => void;
  onAdd: (assistantId: string, role: 'leader' | 'teammate' | 'coach' | 'reviewer') => Promise<void>;
  onCreateNew: () => void;
}

export function AddMemberModal({
  isOpen,
  allAssistants,
  existingMemberIds,
  onClose,
  onAdd,
  onCreateNew,
}: AddMemberModalProps) {
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'leader' | 'teammate' | 'coach' | 'reviewer'>('teammate');
  const [isAdding, setIsAdding] = useState(false);

  if (!isOpen) return null;

  const availableAssistants = allAssistants.filter(
    (a) => !existingMemberIds.includes(a.id)
  );

  const handleAdd = async () => {
    if (!selectedAssistantId) {
      alert('请选择一个助手');
      return;
    }

    setIsAdding(true);
    try {
      await onAdd(selectedAssistantId, selectedRole);
      setSelectedAssistantId('');
      setSelectedRole('teammate');
    } catch (error) {
      console.error('添加成员失败:', error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>添加团队成员</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>选择助手</label>
            <select
              value={selectedAssistantId}
              onChange={(e) => setSelectedAssistantId(e.target.value)}
              disabled={isAdding}
            >
              <option value="">-- 请选择助手 --</option>
              {availableAssistants.map((assistant) => (
                <option key={assistant.id} value={assistant.id}>
                  {assistant.avatar?.startsWith('🤖') ? 'AI' : assistant.avatar} {assistant.name} ({assistant.role})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>团队角色</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as any)}
              disabled={isAdding}
            >
              <option value="teammate">伙伴向导 (Teammate)</option>
              <option value="coach">原理教练 (Coach)</option>
              <option value="reviewer">评审导师 (Reviewer)</option>
              <option value="leader">队长/总负责人 (Leader)</option>
            </select>
          </div>

          <div className="role-hint">
            <p>
              <strong>角色说明：</strong>
            </p>
            <ul>
              <li><strong>伙伴向导</strong>：实践指导，沙箱排错</li>
              <li><strong>原理教练</strong>：苏格拉底式教学，TheoryMastered 门禁</li>
              <li><strong>评审导师</strong>：结项答辩，防作弊质询</li>
              <li><strong>队长</strong>：把控方向，目标拆解，批准立项</li>
            </ul>
          </div>

          {availableAssistants.length === 0 && (
            <div className="empty-state-hint">
              <p>暂无可添加的助手。</p>
              <button
                type="button"
                className="create-assistant-btn"
                onClick={onCreateNew}
              >
                + 创建新助手
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="modal-action-btn is-secondary"
            onClick={onCreateNew}
            disabled={isAdding}
          >
            创建新助手
          </button>
          <button
            type="button"
            className="modal-action-btn is-primary"
            onClick={handleAdd}
            disabled={isAdding || !selectedAssistantId}
          >
            {isAdding ? '添加中...' : '添加成员'}
          </button>
          <button
            type="button"
            className="modal-action-btn"
            onClick={onClose}
            disabled={isAdding}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
