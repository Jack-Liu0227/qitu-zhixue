'use client';

import companion from '../assets/assistant/qitu-companion.png';
import { getVisualAsset } from '@qitu/contracts';
import { VisualAsset } from './visual-assets';
import { useState } from 'react';

function LegacyAvatarImage({ value, size }: { value: string; size: number }) {
  const [failed, setFailed] = useState(false);
  return failed ? <RobotMascot size={size} decorative /> : <img src={value} width={size} height={size} alt="" style={{ objectFit: 'contain', verticalAlign: 'middle' }} onError={() => setFailed(true)} />;
}

/** Shared artwork is bundled per application so Next preserves each basePath. */
export function RobotMascot({
  size = 96,
  mood = 'happy',
  decorative = false,
  className = '',
}: {
  size?: number;
  mood?: 'happy' | 'thinking' | 'cheering';
  decorative?: boolean;
  className?: string;
}) {
  if (mood === 'thinking' || mood === 'cheering') return <VisualAsset assetId={mood === 'thinking' ? 'emotion-thinking-v1' : 'emotion-celebrate-v1'} size={size} alt="启途 AI 智学搭档" decorative={decorative} className={className} />;
  return (
    <img
      className={`qitu-robot qitu-robot-${mood} ${className}`.trim()}
      src={typeof companion === 'string' ? companion : companion.src}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, verticalAlign: 'middle' }}
      alt={decorative ? '' : '启途 AI 智学搭档'}
      aria-hidden={decorative || undefined}
      draggable={false}
    />
  );
}

/** Preserve Admin-selected custom avatars; only replace the legacy robot mark. */
export function AssistantGlyph({ value, size = 24 }: { value?: string | null; size?: number }) {
  const asset = getVisualAsset(value);
  if (asset?.usages.includes('avatar')) return <VisualAsset assetId={asset.id} size={size} />;
  if (value?.startsWith('asset:')) return <RobotMascot size={size} decorative />;
  if (value && /^https?:\/\//.test(value)) return <LegacyAvatarImage key={value} value={value} size={size} />;
  return !value || value.replace(/\uFE0F/g, '').trim() === '🤖'
    ? <RobotMascot size={size} decorative />
    : <span aria-hidden="true">{value}</span>;
}
