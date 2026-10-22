import type { TutorReplyBlock, TutorTurn } from '@qitu/contracts';

/**
 * 序列化单条回复内容块为纯文本剪贴板格式。
 * 遵循未成年人隐私与安全规范：不复制原始工具参数、模型思考链或未脱敏链接。
 */
function serializeBlock(block: TutorReplyBlock): string {
  switch (block.kind) {
    case 'learning_opening':
      return `【${block.mode === 'lesson' ? `第 ${block.lessonIndex} 课` : '探索开始'}】${block.title}\n${block.scenario}\n${block.goal ?? ''}\n${block.prompt}`;
    case 'text':
      return block.text.trim();
    case 'hint':
      return `【引导提示】\n${block.text.trim()}`;
    case 'questions':
      return block.items.map((q, idx) => `${idx + 1}. ${q}`).join('\n');
    case 'options':
      return block.items.map((opt) => `[${opt.label}] ${opt.text}`).join('\n');
    case 'pbl_card': {
      const parts = [`【PBL立项建议】${block.title}`];
      if (block.summary) parts.push(block.summary);
      if (block.tags?.length) parts.push(`标签：${block.tags.join('、')}`);
      return parts.join('\n');
    }
    case 'artifact': {
      const parts = [`【作品成果】${block.title}`];
      if (block.summary) parts.push(block.summary);
      if (block.content) parts.push(block.content);
      return parts.join('\n');
    }
    case 'tool': {
      if (block.call.result) {
        return `【探索实验数据】${block.call.label ?? block.call.name}：${block.call.result}`;
      }
      return '';
    }
    case 'quiz':
      return `【互动测验】${block.stem}`;
    case 'board':
      return `【分步白板】${block.title ?? ''}\n${block.steps.map((step, index) => `${index + 1}. ${step.caption}`).join('\n')}`;
    case 'learning_resource':
      return `【推荐资料】${block.title}\n${block.summary}\n${block.sources.map(source => source.title).join('、')}`;
    case 'milestone':
      return `【阶段检查】${block.title}\n${block.deliverables.map((item) => `${item.submitted ? '已提交' : '待提交'}：${item.title}`).join('\n')}`;
    case 'attachment':
      return `【附件】${block.fileName ?? '文件'}`;
    case 'think':
      return '';
    case 'idea_cards':
      return block.cards.map((card) => `【项目想法】${card.title}\n${card.description}`).join('\n\n');
    default:
      return '';
  }
}

/**
 * 将一轮 TutorTurn 序列化为适合粘贴到 Markdown 或文档中的纯文本。
 * 保留 LaTeX 公式源文本（$...$ / $$...$$），不依赖浏览器的 KaTeX DOM 渲染结构。
 */
export function serializeTutorTurnForClipboard(turn: TutorTurn): string {
  if (!turn || !Array.isArray(turn.blocks)) return '';
  return turn.blocks
    .map(serializeBlock)
    .filter((text) => Boolean(text && text.trim().length > 0))
    .join('\n\n')
    .trim();
}
