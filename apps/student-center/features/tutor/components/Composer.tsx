'use client';

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  type ComposerMode,
  QUICK_PROMPTS,
  type VoiceCapability,
  type VoiceSelection,
  type VoiceStatus,
  blobToPcm16,
  createIdempotencyKey,
  getRecorderMimeType,
} from './composer-voice';

function MicIcon({ active = false }: { active?: boolean }) {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="8" y="3" width="8" height="12" rx="4" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
      {active ? <circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="m4 4 16 8-16 8 3-8-3-8Z" strokeLinejoin="round" />
      <path d="M7 12h13" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l7.88-7.88" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

export interface AttachmentDraft {
  id: string;
  name: string;
  type: 'image' | 'file';
  url: string;
  sizeText?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tutor voice & text input composer following production UI engineering standards. */
export function Composer({
  draft,
  onDraftChange,
  attachments: externalAttachments,
  onAddAttachments: externalAddAttachments,
  onRemoveAttachment: externalRemoveAttachment,
  offline,
  submitting,
  disabled,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  attachments?: AttachmentDraft[];
  onAddAttachments?: (items: AttachmentDraft[]) => void;
  onRemoveAttachment?: (id: string) => void;
  offline: boolean;
  submitting: boolean;
  disabled: boolean;
  onSubmit: (attachments?: AttachmentDraft[]) => void;
}) {
  const [internalAttachments, setInternalAttachments] = useState<AttachmentDraft[]>([]);
  const attachments = externalAttachments ?? internalAttachments;
  const setAttachments = externalAddAttachments
    ? (fn: (prev: AttachmentDraft[]) => AttachmentDraft[]) => {
        // Handled via external props
      }
    : setInternalAttachments;

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<ComposerMode>('text');
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceModel, setVoiceModel] = useState<VoiceSelection | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const voiceBaseRef = useRef('');

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 160)}px`;
  }, [draft, mode]);

  useEffect(() => {
    const hasWebSpeech =
      typeof window !== 'undefined' &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    const recorderReady =
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      getRecorderMimeType().length > 0;

    setVoiceSupported(hasWebSpeech || recorderReady);
    if (!recorderReady) return;
    let disposed = false;
    void fetch('/api/v1/voice/capabilities', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('VOICE_CAPABILITIES_UNAVAILABLE');
        return response.json() as Promise<{ data?: { models?: VoiceCapability[] } }>;
      })
      .then((payload) => {
        if (disposed) return;
        const transcriptionModel = payload.data?.models?.find(
          (model) => Array.isArray(model.operations) && model.operations.includes('transcribe'),
        );
        setVoiceModel(
          transcriptionModel ? { providerId: transcriptionModel.providerId, modelId: transcriptionModel.modelId } : null,
        );
      })
      .catch(() => {
        if (!disposed) setVoiceModel(null);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const releaseStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder === null) {
      releaseStream();
      setVoiceStatus('idle');
      setInterimTranscript('');
      return;
    }
    recorderRef.current = null;
    if (recorder.state !== 'inactive') recorder.stop();
  }, [releaseStream]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      if (voiceModel === null) throw new Error('VOICE_MODEL_UNAVAILABLE');
      const audio = await blobToPcm16(blob);
      const response = await fetch('/api/v1/voice/transcriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
        body: JSON.stringify({ requestId: createIdempotencyKey(), model: voiceModel, audio, language: 'zh-CN' }),
      });
      if (!response.ok) throw new Error('VOICE_TRANSCRIPTION_FAILED');
      const payload = (await response.json()) as { data?: { transcript?: unknown } };
      const transcript = typeof payload.data?.transcript === 'string' ? payload.data.transcript.trim() : '';
      if (!transcript) throw new Error('VOICE_TRANSCRIPTION_EMPTY');
      onDraftChange([voiceBaseRef.current, transcript].filter(Boolean).join(' '));
    },
    [onDraftChange, voiceModel],
  );

  const startListening = useCallback(async () => {
    if (disabled || submitting || offline) return;
    setVoiceError(null);
    setInterimTranscript('');
    voiceBaseRef.current = draft.trim();
    setVoiceStatus('starting');

    // 优先使用浏览器原生高灵敏度 Web Speech API 实时识别
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setVoiceStatus('recording');
          setInterimTranscript('正在聆听你的想法...');
        };

        recognition.onresult = (event: any) => {
          let accumulatedFinal = '';
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              accumulatedFinal += transcript;
            } else {
              interim += transcript;
            }
          }
          if (accumulatedFinal) {
            const combined = voiceBaseRef.current ? `${voiceBaseRef.current} ${accumulatedFinal}` : accumulatedFinal;
            onDraftChange(combined);
            voiceBaseRef.current = combined;
          }
          if (interim) {
            setInterimTranscript(interim);
          }
        };

        recognition.onerror = (e: any) => {
          if (e.error !== 'no-speech') {
            setVoiceError(`语音提示: ${e.error || '未检测到清晰语音'}`);
          }
        };

        recognition.onend = () => {
          setVoiceStatus('idle');
          setInterimTranscript('');
        };

        recognition.start();
        recognitionRef.current = recognition;
        return;
      } catch {
        // Fall back to MediaRecorder
      }
    }

    if (voiceModel === null) {
      setVoiceStatus('error');
      setVoiceError('未检测到语音转写服务，请直接键入文字');
      return;
    }
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
      setVoiceError('当前设备不支持录音，请改用文字输入');
      setVoiceStatus('error');
      return;
    }
    setVoiceError(null);
    setInterimTranscript('');
    voiceBaseRef.current = draft.trim();
    setVoiceStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseStream();
        setVoiceStatus('error');
        setVoiceError('录音暂时不可用，请重试或改用文字输入');
      };
      recorder.onstop = () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        setVoiceStatus('transcribing');
        setInterimTranscript('正在转换语音…');
        void transcribe(blob)
          .then(() => {
            setVoiceError(null);
            setVoiceStatus('idle');
            setInterimTranscript('');
          })
          .catch(() => {
            setVoiceStatus('error');
            setInterimTranscript('');
            setVoiceError('语音转换失败，请重试或改用文字输入');
          });
      };
      recorder.start();
      recorderRef.current = recorder;
      setVoiceStatus('recording');
    } catch {
      releaseStream();
      setVoiceStatus('error');
      setVoiceError('无法访问麦克风，请允许权限后重试');
    }
  }, [disabled, draft, offline, releaseStream, submitting, transcribe, voiceModel]);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseStream();
    },
    [releaseStream],
  );

  useEffect(() => {
    if (offline && voiceStatus !== 'idle') stopListening();
  }, [offline, stopListening, voiceStatus]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const isImg = file.type.startsWith('image/');
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = (e.target?.result as string) || '';
        const item: AttachmentDraft = {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          type: isImg ? 'image' : 'file',
          url,
          sizeText: formatFileSize(file.size),
        };
        if (externalAddAttachments) {
          externalAddAttachments([item]);
        } else {
          setInternalAttachments((prev) => [...prev, item]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachmentItem = (id: string) => {
    if (externalRemoveAttachment) {
      externalRemoveAttachment(id);
    } else {
      setInternalAttachments((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const clipItem = items[i];
      if (!clipItem) continue;
      if (clipItem.type.indexOf('image') !== -1) {
        const blob = clipItem.getAsFile();
        if (blob) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (ev) => {
            const url = (ev.target?.result as string) || '';
            const item: AttachmentDraft = {
              id: `paste-img-${Date.now()}`,
              name: `截图-${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}.png`,
              type: 'image',
              url,
              sizeText: formatFileSize(blob.size),
            };
            if (externalAddAttachments) {
              externalAddAttachments([item]);
            } else {
              setInternalAttachments((prev) => [...prev, item]);
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const isRecording = voiceStatus === 'starting' || voiceStatus === 'recording';
  const hasWebSpeech =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const voiceUnavailable = false; // Always allow user to trigger voice input
  const trimmedLength = draft.trim().length;
  const canSend = (trimmedLength > 0 || attachments.length > 0) && !submitting && !disabled && !offline;

  const toggleRecording = () => {
    setVoiceError(null);
    setInterimTranscript('');
    if (isRecording) {
      stopListening();
    } else {
      void startListening();
    }
  };

  const switchMode = () => {
    setVoiceError(null);
    setInterimTranscript('');
    if (mode === 'voice') {
      stopListening();
      setMode('text');
      return;
    }
    setMode('voice');
    void startListening();
  };

  const submit = () => {
    stopListening();
    if (mode === 'voice') setMode('text');
    if (canSend) {
      onSubmit(attachments);
      if (!externalAddAttachments) {
        setInternalAttachments([]);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const handleApplyPrompt = (promptText: string) => {
    if (disabled) return;
    const nextValue = draft.trim().length > 0 ? `${draft.trim()} ${promptText}` : promptText;
    onDraftChange(nextValue);
    textareaRef.current?.focus();
  };

  return (
    <form className="qitu-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {/* 正在录音或识别时的动态声波指示条 */}
      {isRecording && (
        <div
          style={{
            marginBottom: '8px',
            padding: '8px 12px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12.5px',
            color: '#1d4ed8',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#ef4444',
                boxShadow: '0 0 0 4px rgba(239, 68, 68, 0.2)',
              }}
            />
            <strong>正在倾听你的想法：</strong>
            <span style={{ color: '#2563eb' }}>{interimTranscript || '请对麦克风说话，语音将实时转写为文字...'}</span>
          </div>
          <button
            type="button"
            onClick={stopListening}
            style={{
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              padding: '2px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            完成说话
          </button>
        </div>
      )}

      {mode === 'text' ? (
        <div className="qitu-composer-quick-prompts" role="group" aria-label="启发思考快捷提问">
          <span className="qitu-composer-quick-label">思考灵感：</span>
          {QUICK_PROMPTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="qitu-composer-prompt-chip"
              disabled={disabled || submitting}
              onClick={() => handleApplyPrompt(item.prompt)}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 隐藏的文件输入组件 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".py,.js,.ts,.tsx,.jsx,.html,.css,.json,.md,.txt,.pdf,.docx,.c,.cpp,.java,.zip,.tar,.gz"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        className={`qitu-composer-shell${disabled ? ' is-disabled' : ''}${offline ? ' is-offline' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          outline: isDragging ? '2px dashed #3b82f6' : undefined,
          backgroundColor: isDragging ? '#eff6ff' : undefined,
          transition: 'all 0.15s ease',
        }}
      >
        {/* 已添加的附件列表展示栏 */}
        {attachments.length > 0 && (
          <div
            style={{
              padding: '8px 12px 4px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            {attachments.map((att) => (
              <div
                key={att.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '11.5px',
                  color: '#334155',
                  maxWidth: '220px',
                }}
              >
                {att.type === 'image' ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={att.url}
                    alt=""
                    style={{ width: '20px', height: '20px', objectFit: 'cover', borderRadius: '4px' }}
                  />
                ) : (
                  <span aria-hidden="true" style={{ fontSize: '13px' }}>
                    📎
                  </span>
                )}
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '120px',
                  }}
                  title={att.name}
                >
                  {att.name}
                </span>
                {att.sizeText && <span style={{ color: '#94a3b8', fontSize: '10px' }}>({att.sizeText})</span>}
                <button
                  type="button"
                  onClick={() => removeAttachmentItem(att.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '0 2px',
                    lineHeight: 1,
                  }}
                  title="移除此附件"
                  disabled={submitting}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {mode === 'text' ? (
          <textarea
            ref={textareaRef}
            className="qitu-composer-input"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              offline
                ? '当前离线，先把想法写下来，网络恢复后再发送…'
                : isDragging
                ? '松开鼠标即可添加文件附件…'
                : '说说现在的想法、尝试或卡住的地方（支持点击上传图片/文件，或直接从剪贴板 Ctrl+V 粘贴截图）…'
            }
            disabled={disabled}
            rows={2}
            aria-label="输入你的想法"
          />
        ) : (
          <div className="qitu-composer-voice-panel" aria-live="polite">
            <div className={`qitu-composer-voice-orb${isRecording ? ' is-listening' : ''}`}>
              <MicIcon active={isRecording} />
            </div>
            <div className="qitu-composer-voice-copy">
              <strong>{isRecording ? '正在倾听你的想法…' : voiceStatus === 'transcribing' ? '正在转写语音…' : '语音输入已就绪'}</strong>
              <p>{interimTranscript || (voiceError ?? '点击下方按钮开始说话，说完后停止录音即可转为文字')}</p>
            </div>
          </div>
        )}

        <div className="qitu-composer-actions">
          <div className="qitu-composer-toolbar-left">
            <button
              type="button"
              className={`qitu-composer-mode${isRecording ? ' is-active' : ''}`}
              onClick={toggleRecording}
              disabled={disabled || offline}
              aria-pressed={isRecording}
              aria-label={isRecording ? '停止语音录制' : '点击开始语音输入'}
              title={isRecording ? '停止语音录制' : '点击开始语音输入'}
              style={{
                background: isRecording ? '#fee2e2' : undefined,
                color: isRecording ? '#dc2626' : undefined,
                borderColor: isRecording ? '#fca5a5' : undefined,
              }}
            >
              <MicIcon active={isRecording} />
              <span>{isRecording ? '停止录音' : '语音输入'}</span>
            </button>

            <button
              type="button"
              className="qitu-composer-mode"
              onClick={() => imageInputRef.current?.click()}
              disabled={disabled || offline || submitting}
              aria-label="上传图片"
              title="上传图片（支持拖拽或直接 Ctrl+V 粘贴截图）"
            >
              <ImageIcon />
              <span>图片</span>
            </button>

            <button
              type="button"
              className="qitu-composer-mode"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || offline || submitting}
              aria-label="上传文件或代码"
              title="上传代码脚本、文档或数据文件"
            >
              <PaperclipIcon />
              <span>文件</span>
            </button>

            {mode === 'voice' ? (
              <button
                type="button"
                className={`qitu-composer-voice-button${isRecording ? ' is-listening' : ''}`}
                onClick={isRecording ? stopListening : () => void startListening()}
                disabled={disabled || submitting || offline || voiceUnavailable || voiceStatus === 'transcribing'}
                aria-label={isRecording ? '停止录音' : '开始录音'}
                title={isRecording ? '停止录音' : '开始录音'}
              >
                <MicIcon active={isRecording} />
                <span>{isRecording ? '停止录音' : '开始说话'}</span>
              </button>
            ) : null}

            <span className="qitu-composer-shortcut-hint" aria-hidden="true">
              <kbd>Enter</kbd> 发送 · <kbd>Shift + Enter</kbd> 换行
            </span>
          </div>

          <div className="qitu-composer-toolbar-right">
            {trimmedLength > 0 || attachments.length > 0 ? (
              <>
                <span className="qitu-composer-char-count" aria-live="polite">
                  {trimmedLength > 0 ? `${trimmedLength} 字` : `${attachments.length} 个附件`}
                </span>
                <button
                  type="button"
                  className="qitu-composer-clear"
                  onClick={() => {
                    onDraftChange('');
                    if (externalRemoveAttachment) {
                      attachments.forEach((a) => externalRemoveAttachment(a.id));
                    } else {
                      setInternalAttachments([]);
                    }
                    textareaRef.current?.focus();
                  }}
                  disabled={disabled || submitting}
                  aria-label="清空输入内容与附件"
                >
                  清空
                </button>
              </>
            ) : null}

            <button
              type="submit"
              className={`qitu-button qitu-button-primary qitu-composer-submit${canSend ? ' is-ready' : ''}`}
              disabled={!canSend}
            >
              <SendIcon />
              <span>{submitting ? '发送中…' : offline ? '离线暂存' : '发送想法'}</span>
            </button>
          </div>
        </div>
      </div>

      {offline || voiceUnavailable || (voiceError && !voiceUnavailable) ? (
        <div className="qitu-composer-status-row">
          {offline ? <p className="qitu-composer-hint is-warning">网络已断开，想法已保存在当前输入框，恢复连接后即可发送</p> : null}
          {voiceUnavailable ? <p className="qitu-composer-hint">当前环境未启用语音转写模型，已为你开启沉浸式文字交流模式</p> : null}
          {voiceError && !voiceUnavailable ? <p className="qitu-composer-error" role="alert">{voiceError}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
