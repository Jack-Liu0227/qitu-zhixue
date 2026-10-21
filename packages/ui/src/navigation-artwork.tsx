import { ArtworkImage, VisualAsset } from './visual-assets';
import { getNavigationArtwork } from './navigation-artwork.catalog';
import { FIXED_NAVIGATION_FILES } from './navigation-artwork-files';

/** Fixed navigation artwork, independent of configurable object bindings. */
export function NavigationArtwork({ href, size = 24 }: { href: string; size?: number }) {
  const artwork = getNavigationArtwork(href);
  if (!artwork || artwork.kind === 'library') {
    return <VisualAsset assetId={artwork?.assetId ?? 'capability-tools-v1'} size={size} />;
  }
  const files = FIXED_NAVIGATION_FILES[artwork.id];
  const file = size <= 32 ? files.small : files.large;
  const src = typeof file === 'string' ? file : file.src;
  return <ArtworkImage src={src} size={size} width={size} alt="" decorative fit="contain" className="qitu-navigation-artwork" />;
}
