'use client';

import { useState, type CSSProperties } from 'react';
import { getVisualAsset } from '@qitu/contracts';
import { VISUAL_FILES } from './visual-asset-files';

export function ArtworkImage({ src, size, alt, decorative, fit, width, aspectRatio, className }: {
  src: string; size: number; alt: string; decorative: boolean; fit: 'contain' | 'cover'; width: number | string;
  aspectRatio?: CSSProperties['aspectRatio']; className: string;
}) {
  const [failed, setFailed] = useState(false);
  const style: CSSProperties = {
    width,
    height: aspectRatio === undefined ? size : 'auto',
    aspectRatio,
    objectFit: fit,
    flexShrink: 0,
    display: 'inline-block',
    verticalAlign: 'middle',
    maxWidth: '100%',
  };
  return failed ? <span className="qitu-artwork-fallback" style={style} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : alt}>◇</span>
    : <img className={`qitu-artwork ${className}`} src={src} alt={decorative ? '' : alt} aria-hidden={decorative || undefined}
      width={typeof width === 'number' ? width : undefined} height={size} style={style} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

export function VisualAsset({ assetId, size = 48, width, alt, decorative = true, fit = 'contain', aspectRatio, className = '' }: {
  assetId?: string | null; size?: number; width?: number | string; alt?: string; decorative?: boolean;
  fit?: 'contain' | 'cover'; aspectRatio?: CSSProperties['aspectRatio']; className?: string;
}) {
  const asset = getVisualAsset(assetId);
  const file = asset ? VISUAL_FILES[asset.id] : undefined;
  if (!file) return <span className="qitu-artwork-fallback" style={{ width: width ?? size, height: aspectRatio === undefined ? size : 'auto', aspectRatio }} aria-hidden={decorative || undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : alt ?? asset?.name ?? '图片暂不可用'}>◇</span>;
  const source = size <= 64 ? file.small : file.large;
  const src = typeof source === 'string' ? source : source.src;
  return <ArtworkImage key={src} src={src} size={size} width={width ?? size} alt={alt ?? asset?.name ?? ''} decorative={decorative}
    fit={fit} aspectRatio={aspectRatio} className={className} />;
}

export function EntityCover({ assetId, height = 160, aspectRatio, alt = '', className = '' }: {
  assetId?: string | null; height?: number; aspectRatio?: CSSProperties['aspectRatio']; alt?: string; className?: string;
}) {
  return <VisualAsset assetId={assetId} size={height} width="100%" fit="cover" aspectRatio={aspectRatio}
    alt={alt} decorative={!alt} className={className} />;
}
