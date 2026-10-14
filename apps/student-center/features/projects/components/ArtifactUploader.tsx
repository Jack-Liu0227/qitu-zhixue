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
      // `purpose` 必须是服务端 `PRESIGN_PURPOSES` 中的值
      // （artifact | evidence | thumbnail | other）。此前这里发的是
      // `project-submission`，不在白名单内，服务端 `normalizePresign` 会抛
      // ARTIFACT_INVALID（上传用途非法），真实的 presign 调用必然失败。
      // 作品文件属于 artifact。
      purpose: 'artifact',
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      // `sizeBytes` 是服务端**必填**的有限正数（normalizePresign 会校验），
      // 此前完全没有发送，同样导致 presign 直接 400。
      sizeBytes: file.size,
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
