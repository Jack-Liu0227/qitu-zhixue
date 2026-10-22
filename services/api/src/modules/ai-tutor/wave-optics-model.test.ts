import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWaveOpticsParameters, projectWaveOptics, waveOpticsIntensity, WaveOpticsDomainError } from '@qitu/ai-client';
import { validateTutorExperimentAction } from './tutor-experiment.validation';

const parameters = { wavelength: 550, slitWidth: 20, slitSeparation: 150, screenDistance: 2 };
const near = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('finite-width double slits have a normalized symmetric nonnegative profile with an actual diffraction envelope', () => {
  const p = parseWaveOpticsParameters('interference', parameters);
  const model = projectWaveOptics(p);
  assert.equal(model.samples.length, 1025);
  assert.equal(model.provenance, 'model_calculation');
  near(waveOpticsIntensity(p, 0), 1);
  near(waveOpticsIntensity(p, 7.1), waveOpticsIntensity(p, -7.1));
  assert.ok(model.samples.every(sample => sample.normalizedIntensity >= 0 && sample.normalizedIntensity <= 1));
  const lambda = parameters.wavelength * 1e-9;
  const firstEnvelopeMinimum = parameters.screenDistance * Math.tan(Math.asin(lambda / (parameters.slitWidth * 1e-6))) * 1000;
  near(waveOpticsIntensity(p, firstEnvelopeMinimum), 0);
  const firstInterferenceMinimum = parameters.screenDistance * Math.tan(Math.asin(lambda / (2 * parameters.slitSeparation * 1e-6))) * 1000;
  near(waveOpticsIntensity(p, firstInterferenceMinimum), 0);
  near(model.fringeSpacingMm ?? 0, 550 * 2 / 150);
});

test('changing separation controls fringe spacing while changing aperture width controls the diffraction envelope', () => {
  const base = projectWaveOptics(parseWaveOpticsParameters('interference', parameters));
  const farther = projectWaveOptics(parseWaveOpticsParameters('interference', { ...parameters, slitSeparation: 225 }));
  near(farther.fringeSpacingMm ?? 0, (base.fringeSpacingMm ?? 0) * 2 / 3);
  near(farther.centralBandWidthMm, base.centralBandWidthMm);
  const wider = projectWaveOptics(parseWaveOpticsParameters('interference', { ...parameters, slitWidth: 40 }));
  near(wider.fringeSpacingMm ?? 0, base.fringeSpacingMm ?? 0);
  assert.ok(wider.centralBandWidthMm < base.centralBandWidthMm);
  const single = projectWaveOptics(parseWaveOpticsParameters('diffraction', { wavelength: 550, slitWidth: 20, screenDistance: 2 }));
  assert.equal(single.fringeSpacingMm, null);
  near(single.centralBandWidthMm, base.centralBandWidthMm);
});

test('registered wave model rejects malformed, overlapping and out-of-domain apertures instead of drawing a plausible fake', () => {
  for (const invalid of [
    { ...parameters, wavelength: NaN }, { ...parameters, slitSeparation: 10 },
    { ...parameters, slitWidth: 150, slitSeparation: 150 }, { ...parameters, screenDistance: 0 },
    { ...parameters, wavelength: 400, slitSeparation: 400, screenDistance: 0.5 },
    { ...parameters, html: '<script>' },
  ]) assert.throws(() => parseWaveOpticsParameters('interference', invalid), WaveOpticsDomainError);
  assert.throws(() => parseWaveOpticsParameters('scattering', parameters), WaveOpticsDomainError);
  assert.throws(() => validateTutorExperimentAction('interference', 'run', { mode: 'interference', parameters }));
  assert.ok(validateTutorExperimentAction('interference', 'run', { mode: 'interference', parameters }, '2.0.0').simulationResult?.waveProjection);
  assert.throws(() => validateTutorExperimentAction('interference', 'run', { mode: 'interference', parameters, mark_mastered: true }, '2.0.0'));
});
