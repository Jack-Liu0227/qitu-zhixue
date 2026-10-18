import companion from '../assets/assistant/qitu-companion.png';

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
  return !value || value.replace(/\uFE0F/g, '').trim() === '🤖'
    ? <RobotMascot size={size} decorative />
    : <span aria-hidden="true">{value}</span>;
}
