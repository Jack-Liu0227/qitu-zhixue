import { BadRequestException } from '@nestjs/common';
import type { TutorExperimentAction, TutorExperimentActionResponse } from '@qitu/contracts';

export function validateTutorExperimentAction(
  initialMode: 'diffraction' | 'scattering' | undefined,
  action: TutorExperimentAction,
  rawPayload: unknown,
): {
  auditPayload: Record<string, unknown>;
  simulationResult?: TutorExperimentActionResponse['simulationResult'];
} {
  if (typeof rawPayload !== 'object' || rawPayload === null || Array.isArray(rawPayload)) {
    throw new BadRequestException({ code: 'TUTOR_EXPERIMENT_INPUT_INVALID', message: 'Invalid experiment payload' });
  }
  const payload = rawPayload as Record<string, unknown>;
  const mode = payload.mode;
  if (mode !== 'diffraction' && mode !== 'scattering') {
    throw new BadRequestException({ code: 'TUTOR_EXPERIMENT_INPUT_INVALID', message: 'Invalid experiment model' });
  }
  // `initialMode` is presentation state, not an authorization grant. The
  // governed optics card may switch between its two registered models; each
  // model is still validated against its own bounded parameter domain below.
  void initialMode;
  if (action === 'submit_prediction') {
    const hypothesis = payload.hypothesis;
    if (typeof hypothesis !== 'string' || hypothesis.trim().length < 1 || hypothesis.length > 200) {
      throw new BadRequestException({ code: 'TUTOR_EXPERIMENT_INPUT_INVALID', message: 'A prediction option is required' });
    }
    return { auditPayload: { mode, predictionProvided: true } };
  }

  if (typeof payload.parameters !== 'object' || payload.parameters === null || Array.isArray(payload.parameters)) {
    throw new BadRequestException({ code: 'TUTOR_EXPERIMENT_INPUT_INVALID', message: 'Experiment parameters are required' });
  }
  const parameters = payload.parameters as Record<string, unknown>;
  const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
  let simulationResult: TutorExperimentActionResponse['simulationResult'];
  let safeParameters: Record<string, number>;
  if (mode === 'diffraction') {
    const wavelength = parameters.wavelength;
    const slitWidth = parameters.slitWidth;
    const screenDistance = parameters.screenDistance;
    if (!finiteInRange(wavelength, 400, 750) || !finiteInRange(slitWidth, 10, 200)
      || !finiteInRange(screenDistance, 0.5, 2)) {
      throw new BadRequestException({ code: 'TUTOR_EXPERIMENT_INPUT_INVALID', message: 'Diffraction parameters are outside the approved range' });
    }
    const firstMinimumRad = Math.asin(wavelength / (slitWidth * 1000));
    const centralBandWidthMm = 2 * screenDistance * Math.tan(firstMinimumRad) * 1000;
    safeParameters = { wavelength, slitWidth, screenDistance };
    simulationResult = {
      mode,
      summary: `Model estimate: central bright-band width is about ${centralBandWidthMm.toFixed(2)} mm; this is not a measurement.`,
    };
  } else {
    const wavelength = parameters.wavelength;
    const particleRadius = parameters.particleRadius;
    if (!finiteInRange(wavelength, 400, 750) || !finiteInRange(particleRadius, 5, 300)) {
      throw new BadRequestException({ code: 'TUTOR_EXPERIMENT_INPUT_INVALID', message: 'Scattering parameters are outside the approved range' });
    }
    const sizeParameter = (2 * Math.PI * particleRadius) / wavelength;
    const regime = sizeParameter < 0.1 ? 'within the Rayleigh approximation' : 'outside this card’s Rayleigh approximation';
    safeParameters = { wavelength, particleRadius };
    simulationResult = {
      mode,
      summary: `Model size parameter x is about ${sizeParameter.toFixed(3)}, ${regime}; no measured intensity or color is implied.`,
    };
  }
  return { auditPayload: { mode, parameters: safeParameters }, simulationResult };
}
