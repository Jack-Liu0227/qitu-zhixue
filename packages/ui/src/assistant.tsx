'use client';

import { getVisualAsset } from '@qitu/contracts';
import { VisualAsset } from './visual-assets';

export function RobotMascot({ size = 96, mood = 'happy', decorative = false, className = '' }: {
  size?: number; mood?: 'happy' | 'thinking' | 'cheering'; decorative?: boolean; className?: string;
}) {
  const assetId = mood === 'thinking' ? 'emotion-thinking-v1'
    : mood === 'cheering' ? 'emotion-celebrate-v1' : 'avatar-general-v1';
  return <VisualAsset assetId={assetId} size={size} alt="启途 AI 智学搭档" decorative={decorative} className={className} />;
}

/** Legacy emoji and URLs render the library default. */
export function AssistantGlyph({ value, size = 24 }: { value?: string | null; size?: number }) {
  const asset = getVisualAsset(value);
  return <VisualAsset assetId={asset?.usages.includes('avatar') ? asset.id : 'avatar-general-v1'} size={size} />;
}
