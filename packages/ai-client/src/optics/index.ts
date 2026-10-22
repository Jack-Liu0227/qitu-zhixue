import type { WaveOpticsParameters, WaveOpticsProjection } from '@qitu/contracts';

export type { WaveOpticsParameters, WaveOpticsProjection } from '@qitu/contracts';
export class WaveOpticsDomainError extends Error {
  constructor(message: string) { super(message); this.name = 'WaveOpticsDomainError'; }
}
function reject(message: string): never { throw new WaveOpticsDomainError(message); }
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Closed parameter parser, shared by server computation and presentation previews. */
export function parseWaveOpticsParameters(mode: unknown, raw: unknown): WaveOpticsParameters {
  if (mode !== 'interference' && mode !== 'diffraction') reject('Unknown wave optics model');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('Wave model parameters required');
  const allowed = mode === 'interference' ? ['wavelength', 'slitWidth', 'slitSeparation', 'screenDistance'] : ['wavelength', 'slitWidth', 'screenDistance'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) reject('Unknown wave model parameter');
  if (!('wavelength' in raw) || !bounded(raw.wavelength, 400, 750)
    || !('slitWidth' in raw) || !bounded(raw.slitWidth, 10, 200)
    || !('screenDistance' in raw) || !bounded(raw.screenDistance, 0.5, 2)) reject('Wave parameters outside approved domain');
  const common = { wavelength: raw.wavelength, slitWidth: raw.slitWidth, screenDistance: raw.screenDistance };
  if (mode === 'diffraction') {
    requireFarField(raw.slitWidth, raw.wavelength, raw.screenDistance);
    return { mode, ...common };
  }
  if (!('slitSeparation' in raw) || !bounded(raw.slitSeparation, 40, 400) || raw.slitSeparation <= raw.slitWidth) {
    reject('Slit centre separation must exceed slit width within 40–400 micrometres');
  }
  requireFarField(raw.slitSeparation + raw.slitWidth, raw.wavelength, raw.screenDistance);
  return { mode, ...common, slitSeparation: raw.slitSeparation };
}

function requireFarField(apertureMicrometres: number, wavelengthNm: number, distanceMetres: number): number {
  const fresnel = (apertureMicrometres * 1e-6) ** 2 / (wavelengthNm * 1e-9 * distanceMetres);
  if (fresnel > 0.1) reject('Outside approved far-field approximation; reduce aperture extent or increase screen distance');
  return fresnel;
}

function sincSquared(value: number): number {
  if (Math.abs(value) < 1e-10) return 1;
  return (Math.sin(value) / value) ** 2;
}

/** Uniform monochromatic coherent equal-amplitude slits; finite aperture envelope is always retained. */
export function waveOpticsIntensity(parameters: WaveOpticsParameters, positionMm: number): number {
  if (!Number.isFinite(positionMm)) reject('Invalid screen coordinate');
  const p = parseWaveOpticsParameters(parameters.mode, parametersWithoutMode(parameters));
  return intensityAt(p, positionMm);
}

function intensityAt(p: WaveOpticsParameters, positionMm: number): number {
  const y = positionMm / 1000;
  const sinTheta = y / Math.hypot(p.screenDistance, y);
  const envelope = sincSquared(Math.PI * p.slitWidth * 1000 * sinTheta / p.wavelength);
  const modulation = p.mode === 'interference' ? Math.cos(Math.PI * p.slitSeparation * 1000 * sinTheta / p.wavelength) ** 2 : 1;
  return Math.max(0, Math.min(1, envelope * modulation));
}

export function parametersWithoutMode(p: WaveOpticsParameters): Record<string, number> {
  return { wavelength: p.wavelength, slitWidth: p.slitWidth, screenDistance: p.screenDistance,
    ...(p.mode === 'interference' ? { slitSeparation: p.slitSeparation } : {}) };
}

export function projectWaveOptics(parameters: WaveOpticsParameters): WaveOpticsProjection {
  const p = parseWaveOpticsParameters(parameters.mode, parametersWithoutMode(parameters));
  const minimumAngle = Math.asin(p.wavelength / (p.slitWidth * 1000));
  const centralBandWidthMm = 2 * p.screenDistance * Math.tan(minimumAngle) * 1000;
  const fringeSpacingMm = p.mode === 'interference' ? p.wavelength * 1e-6 * p.screenDistance / (p.slitSeparation * 1e-6) : null;
  const extent = p.mode === 'interference' ? p.slitSeparation + p.slitWidth : p.slitWidth;
  const fresnelNumber = requireFarField(extent, p.wavelength, p.screenDistance);
  const halfRange = centralBandWidthMm * 0.8;
  const samples = Array.from({ length: 1025 }, (_, index) => {
    const positionMm = -halfRange + halfRange * 2 * index / 1024;
    return { positionMm, normalizedIntensity: intensityAt(p, positionMm) };
  });
  return { specVersion: 'wave-optics-model.v1', mode: p.mode, provenance: 'model_calculation',
    normalization: 'central_peak_one', centralBandWidthMm, fringeSpacingMm, fresnelNumber, samples };
}
