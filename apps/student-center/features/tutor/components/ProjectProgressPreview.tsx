'use client';

import { useMemo, useState } from 'react';
import type { StageProgressDisplay, TemplateStage, TemplateSubNode } from '@qitu/contracts';
import { ProgressBar, SectionCard } from '@qitu/ui';

interface DefaultPblSubNode {
  id: string;
  label: string;
  description: string;
  competency: string;
  deliverable: string;
}

const DEFAULT_STAGE_SUB_NODES: Record<number, DefaultPblSubNode[]> = {
  0: [
    {
      id: 'sub-0-1',
      label: '启发问答与意图确认',
      description: '与 AI搭档通过苏格拉底式提问，明确研究方向与现实生活问题痛点。',
      competency: '探究好奇心 · 问题意识',
      deliverable: '课题立项意向书',
    },
    {
      id: 'sub-0-2',
      label: '核心问题与变量拆解',
      description: '梳理研究边界，厘清因变量与自变量，完成课题分解树。',
      competency: '系统化拆解 · 批判性思维',
      deliverable: '核心问题拆解图',
    },
    {
      id: 'sub-0-3',
      label: '学习目标与实验计划',
      description: '设定阶段性里程碑，评估实验材料与所需知识点储备。',
      competency: '规划与时间管理',
      deliverable: '项目实施甘特计划',
    },
  ],
  1: [
    {
      id: 'sub-1-1',
      label: '核心理论概念研读 (TheoryMastered)',
      description: '掌握项目涉及的基础科学或技术原理，通过启发式问答检验理解。',
      competency: '理论掌握度 · 跨学科知识',
      deliverable: '概念研读卡片',
    },
    {
      id: 'sub-1-2',
      label: '技术路线与设计方案制定',
      description: '完成技术架构或实验流程方案设计，形成可执行步骤。',
      competency: '工程设计 · 方案权衡',
      deliverable: '技术方案设计图',
    },
    {
      id: 'sub-1-3',
      label: '可行性推导与假设论证',
      description: '建立假设推演模型，识别潜在风险并制定备用应对预案。',
      competency: '逻辑论证 · 风险预判',
      deliverable: '可行性论证备忘录',
    },
  ],
  2: [
    {
      id: 'sub-2-1',
      label: '动手搭建与原型实现',
      description: '进入实践验证，亲自动手搭建实验装置、编写原型代码或制作实体模型。',
      competency: '动手实践力 · 创造力',
      deliverable: '初始原型物 / 代码工程',
    },
    {
      id: 'sub-2-2',
      label: '数据采集与实验测试',
      description: '按规范采集实验数据或系统运行日志，保持数据真实不可伪造。',
      competency: '实证精神 · 数据分析',
      deliverable: '原始实验数据集',
    },
    {
      id: 'sub-2-3',
      label: '问题排查与迭代调优',
      description: '定位测试中暴露的异常现象，通过参数调节与设计迭代优化效果。',
      competency: '排错与逆商 · 持续迭代',
      deliverable: '迭代日志与前后对比',
    },
  ],
  3: [
    {
      id: 'sub-3-1',
      label: '成果报告与交付物生成',
      description: '将实验过程与结论结构化整理为规范的结题文档与展示产物。',
      competency: '书面表达 · 成果提炼',
      deliverable: '结题研究报告.md',
    },
    {
      id: 'sub-3-2',
      label: '答辩汇报材料与演练',
      description: '制作汇报幻灯片，与 AI搭档进行模拟问答辩护演练。',
      competency: '口头表达 · 答辩临场力',
      deliverable: '答辩幻灯片与问答预案',
    },
  ],
  4: [
    {
      id: 'sub-4-1',
      label: '素养雷达复盘自评',
      description: '回顾整个项目生命周期，沉淀个人能力成长数据。',
      competency: '元认知 · 反思自省',
      deliverable: '个人能力雷达自评表',
    },
    {
      id: 'sub-4-2',
      label: '成长档案沉淀与认证',
      description: '班主任与系统完成终身成长证据上链存档与导师评语沉淀。',
      competency: '终身学习 · 成长确权',
      deliverable: '成长档案官方认证页',
    },
  ],
};

export function ProjectProgressPreview({
  projectTitle,
  stages,
  progress,
}: {
  projectTitle?: string;
  stages: TemplateStage[];
  progress: StageProgressDisplay;
}) {
  // 每个大节点和小节点默认折叠（Set 初始为空）
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [expandedSubNodes, setExpandedSubNodes] = useState<Set<string>>(new Set());

  const stageData = useMemo(() => {
    return stages.map((stage, sIdx) => {
      const isDone = sIdx < progress.currentStageIndex;
      const isCurrent = sIdx === progress.currentStageIndex;
      const status: 'done' | 'current' | 'locked' = isDone ? 'done' : isCurrent ? 'current' : 'locked';

      const defaultSubs = DEFAULT_STAGE_SUB_NODES[sIdx] ?? [];
      const subNodes: TemplateSubNode[] =
        stage.subNodes && stage.subNodes.length > 0
          ? stage.subNodes
          : defaultSubs.map((sub, subIdx) => {
              let subStatus: 'done' | 'current' | 'locked' = 'locked';
              if (isDone) subStatus = 'done';
              else if (isCurrent) {
                subStatus = subIdx === 0 ? 'current' : 'locked';
              }
              return {
                id: sub.id,
                label: sub.label,
                description: sub.description,
                status: subStatus,
                deliverables: [sub.deliverable],
              };
            });

      const doneCount = subNodes.filter((n) => n.status === 'done').length;
      return {
        ...stage,
        index: sIdx,
        status,
        subNodes,
        doneCount,
        totalCount: subNodes.length,
      };
    });
  }, [stages, progress]);

  const toggleStage = (stageId: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) {
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  };

  const toggleSubNode = (subId: string) => {
    setExpandedSubNodes((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) {
        next.delete(subId);
      } else {
        next.add(subId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedStages(new Set(stages.map((s) => s.id)));
    const allSubs: string[] = [];
    stageData.forEach((s) => s.subNodes.forEach((sub) => allSubs.push(sub.id)));
    setExpandedSubNodes(new Set(allSubs));
  };

  const collapseAll = () => {
    setExpandedStages(new Set());
    setExpandedSubNodes(new Set());
  };

  return (
    <SectionCard title="项目进度预览">
      <div className="qitu-progress-overview-box">
        {projectTitle ? (
          <div className="qitu-progress-project-title-row">
            <span className="qitu-progress-project-badge">当前项目</span>
            <strong className="qitu-progress-project-title">{projectTitle}</strong>
          </div>
        ) : null}

        <div className="qitu-progress-bar-wrap">
          <div className="qitu-progress-bar-meta">
            <span>总进度</span>
            <strong>
              {progress.currentStageIndex + 1} / {progress.stageTotal} 阶段 ({progress.progressPercent}%)
            </strong>
          </div>
          <ProgressBar percent={progress.progressPercent} label={`${progress.progressPercent}%`} />
        </div>

        <div className="qitu-progress-toggle-actions">
          <button type="button" className="qitu-progress-toggle-btn" onClick={collapseAll}>
            全部折叠
          </button>
          <button type="button" className="qitu-progress-toggle-btn" onClick={expandAll}>
            展开全部
          </button>
        </div>
      </div>

      <div className="qitu-progress-stages-accordion">
        {stageData.map((stage) => {
          const isExpanded = expandedStages.has(stage.id);
          const statusIcon =
            stage.status === 'done' ? '✓' : stage.status === 'current' ? '⏳' : '🔒';
          const statusLabel =
            stage.status === 'done' ? '已达成' : stage.status === 'current' ? '进行中' : '待解锁';

          return (
            <div
              key={stage.id}
              className={`qitu-progress-stage-card is-${stage.status}${isExpanded ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="qitu-progress-stage-header-btn"
                onClick={() => toggleStage(stage.id)}
                aria-expanded={isExpanded}
              >
                <div className="qitu-progress-stage-left">
                  <span className="qitu-progress-stage-num">0{stage.index + 1}</span>
                  <div className="qitu-progress-stage-title-wrap">
                    <strong className="qitu-progress-stage-label">{stage.label}</strong>
                    <span className="qitu-progress-stage-subcount">
                      {stage.doneCount}/{stage.totalCount} 节点
                    </span>
                  </div>
                </div>

                <div className="qitu-progress-stage-right">
                  <span className={`qitu-progress-stage-badge is-${stage.status}`}>
                    {statusIcon} {statusLabel}
                  </span>
                  <span className="qitu-progress-chevron">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded ? (
                <div className="qitu-progress-stage-body">
                  <ol className="qitu-progress-subnode-list">
                    {stage.subNodes.map((sub, subIdx) => {
                      const isSubOpen = expandedSubNodes.has(sub.id);
                      const subStatus = sub.status ?? 'locked';
                      const subStatusIcon =
                        subStatus === 'done' ? '●' : subStatus === 'current' ? '◐' : '○';

                      return (
                        <li
                          key={sub.id}
                          className={`qitu-progress-subnode-item is-${subStatus}${isSubOpen ? ' is-open' : ''}`}
                        >
                          <button
                            type="button"
                            className="qitu-progress-subnode-header-btn"
                            onClick={() => toggleSubNode(sub.id)}
                            aria-expanded={isSubOpen}
                          >
                            <span className="qitu-progress-subnode-dot">{subStatusIcon}</span>
                            <span className="qitu-progress-subnode-label">
                              {stage.index + 1}.{subIdx + 1} {sub.label}
                            </span>
                            <span className="qitu-progress-subnode-chevron">
                              {isSubOpen ? '收起' : '详情'}
                            </span>
                          </button>

                          {isSubOpen ? (
                            <div className="qitu-progress-subnode-detail">
                              {sub.description ? (
                                <p className="qitu-progress-subnode-desc">{sub.description}</p>
                              ) : null}
                              {sub.deliverables && sub.deliverables.length > 0 ? (
                                <div className="qitu-progress-subnode-deliverable-box">
                                  <span className="qitu-progress-deliverable-tag">预期产出：</span>
                                  {sub.deliverables.map((d, dIdx) => (
                                    <span key={dIdx} className="qitu-progress-deliverable-item">
                                      📄 {d}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
