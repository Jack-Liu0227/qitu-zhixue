'use client';

import { useRef } from 'react';
import { useArtifactPresign } from '../hooks/useProjectsMutations';

export interface ArtifactUploaderProps {
  disabled?: boolean;
  onUploaded?: (objectKey: string) => void;
}

/**
 * 作品文件上传入口，走 `/api/v1/files/presign`（C12）。
 * 预签名请求经数据源发起，组件不直接 fetch；真实 PUT 由 Wave 4 接入。
 */
export function ArtifactUploader({ disabled = false, onUploaded }: ArtifactUploaderProps) {
  const { mutate, pending, error } = useArtifactPresign();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const response = await mutate({
      purpose: 'project-submission',
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
    });
    if (response) onUploaded?.(response.objectKey);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="qitu-artifact-uploader">
      <input
        ref={inputRef}
        type="file"
        disabled={disabled || pending}
        onChange={(event) => void handleChange(event.target.files?.[0])}
      />
      {pending ? <span>正在准备上传…</span> : null}
      {error ? <p className="qitu-form-error">上传准备失败：{error.message}</p> : null}
    </div>
  );
}
