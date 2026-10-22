import { parseWaveOpticsParameters, projectWaveOptics } from '@qitu/ai-client';
import type { TutorReplyBlock } from '@qitu/contracts';

/** A read-only conceptual diagram. It has no experiment/action IDs and cannot save observations. */
export function buildWavePreview(boardId: string, title: string, summary: string): Extract<TutorReplyBlock, { kind: 'board' }> {
  const defaults = { wavelength: 550, slitWidth: 20, screenDistance: 2 };
  const steps = (['diffraction', 'interference'] as const).map(mode => {
    const model = projectWaveOptics(parseWaveOpticsParameters(mode, mode === 'interference' ? { ...defaults, slitSeparation: 150 } : defaults));
    const extent = Math.max(...model.samples.map(sample => Math.abs(sample.positionMm)));
    const path = model.samples.map((sample, index) => `${index ? 'L' : 'M'}${(35 + (sample.positionMm + extent) / (extent * 2) * 570).toFixed(1)},${(125 - sample.normalizedIntensity * 100).toFixed(1)}`).join(' ');
    const svg = `<svg viewBox="0 0 640 170"><line x1="35" y1="125" x2="605" y2="125" stroke="#94a3b8"/><line x1="35" y1="20" x2="35" y2="125" stroke="#94a3b8"/><path d="${path}" stroke="${mode === 'interference' ? '#2563eb' : '#7c3aed'}" stroke-width="2" fill="none"/><text x="35" y="155" fill="#64748b" font-size="12">${(-extent).toFixed(1)} mm</text><text x="320" y="155" text-anchor="middle" fill="#64748b" font-size="12">0 mm</text><text x="605" y="155" text-anchor="end" fill="#64748b" font-size="12">${extent.toFixed(1)} mm</text><text x="45" y="18" fill="#64748b" font-size="12">relative intensity 0–1</text></svg>`;
    return { caption: `${mode === 'interference' ? '有限宽双缝' : '单缝'}：理想远场模型图示，非实测。波长 550 nm，缝宽 20 μm，屏距 2 m${mode === 'interference' ? '，缝间距 150 μm' : ''}。${summary}`, svg };
  });
  return { kind: 'board', boardId, title, steps, provenance: { origin: 'generated', sources: [] } };
}
