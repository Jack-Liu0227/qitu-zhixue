'use client';

import type { TutorReplyBlock } from '@qitu/contracts';
import type { VoiceTranscriptMessage } from '../realtime/reducer';

export interface VoiceTranscriptProps {
  messages: VoiceTranscriptMessage[];
}

function BlockView({ block }: { block: TutorReplyBlock }) {
  switch (block.kind) {
    case 'text':
      return <p className="qitu-voice-block-text">{block.text}</p>;
    case 'hint':
      return (
        <p className="qitu-voice-block-hint">
          <span className="qitu-voice-block-badge">提示 {block.level}</span>
          {block.text}
        </p>
      );
    case 'questions':
      return (
        <ul className="qitu-voice-block-questions">
          {block.items.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      );
    case 'options':
      return (
        <ul className="qitu-voice-block-options">
          {block.items.map((item, index) => (
            <li key={`${item.label}-${index}`}>{item.text}</li>
          ))}
        </ul>
      );
    case 'evidence':
      return <p className="qitu-voice-block-evidence">证据：{block.ref}</p>;
    default:
      return null;
  }
}

/**
 * Live transcript display.
 *
 * Renders in-memory messages only. Audio payloads never reach this component,
 * and `asr.partial` / `tutor.delta` streaming is indicated, not persisted.
 */
export function VoiceTranscript({ messages }: VoiceTranscriptProps) {
  return (
    <ol className="qitu-voice-transcript" aria-live="polite">
      {messages.map((message) => {
        // Defensive: a safety-blocked assistant turn is never rendered.
        if (message.blocked) return null;
        return (
          <li
            key={message.key}
            className={`qitu-voice-message qitu-voice-message-${message.role}`}
          >
            <div className="qitu-voice-message-meta">
              <span className="qitu-voice-message-role">
                {message.role === 'student' ? '我' : 'AI搭档'}
              </span>
              <span className="qitu-voice-message-modality">
                {message.modality === 'voice' ? '语音' : '文字'}
              </span>
              {typeof message.hintLevel === 'number' ? (
                <span className="qitu-voice-message-hint">提示等级 {message.hintLevel}</span>
              ) : null}
            </div>
            <div className="qitu-voice-message-body">
              {message.blocks && message.blocks.length > 0 ? (
                message.blocks.map((block, index) => (
                  <BlockView key={`${message.key}-block-${index}`} block={block} />
                ))
              ) : message.text.length > 0 ? (
                <p className="qitu-voice-block-text">{message.text}</p>
              ) : (
                <p className="qitu-voice-block-pending">正在倾听…</p>
              )}
              {message.streaming ? (
                <span className="qitu-voice-streaming-caret" aria-hidden="true">
                  ▍
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
