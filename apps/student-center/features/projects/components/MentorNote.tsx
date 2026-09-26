import { HandwrittenNote, SectionCard } from '@qitu/ui';
import type { MentorNoteView } from '../types';

export interface MentorNoteProps {
  note: MentorNoteView;
}

/**
 * 班主任留言：只读、脱敏、最小字段（验收 15）。
 * 不包含原始对话转写或语音引用；字段仅 author / message / updatedAt。
 */
export function MentorNote({ note }: MentorNoteProps) {
  return (
    <SectionCard title="班主任留言">
      <div className="qitu-mentor-note">
        <p>{note.message}</p>
        <footer>
          <span>{note.author}</span>
          <span>{note.updatedAt}</span>
        </footer>
        <HandwrittenNote>仅显示必要信息</HandwrittenNote>
      </div>
    </SectionCard>
  );
}
