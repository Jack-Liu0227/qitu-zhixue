import { VoiceLivePanel, VoiceProvider } from '../../../../features/voice';

/**
 * `/student/inspiration/explore/:sessionId` — the Live surface that HOSTS the
 * voice capability, mounted exactly as the voice module documents:
 * `<VoiceProvider sessionId={...}><VoiceLivePanel /></VoiceProvider>`.
 */
export default async function InspirationExploreRoute({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <VoiceProvider sessionId={sessionId}>
      <VoiceLivePanel />
    </VoiceProvider>
  );
}
