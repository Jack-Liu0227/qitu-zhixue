export type OpticsExperimentMode = 'diffraction' | 'scattering' | 'interference';

/** All distances are explicitly labelled: wavelength nm, aperture sizes micrometres, screen distance metres. */
export type WaveOpticsParameters = {
  mode: 'diffraction'; wavelength: number; slitWidth: number; screenDistance: number;
} | {
  mode: 'interference'; wavelength: number; slitWidth: number; slitSeparation: number; screenDistance: number;
};

export interface WaveOpticsProjection {
  specVersion: 'wave-optics-model.v1';
  mode: WaveOpticsParameters['mode'];
  provenance: 'model_calculation';
  normalization: 'central_peak_one';
  centralBandWidthMm: number;
  fringeSpacingMm: number | null;
  fresnelNumber: number;
  samples: readonly { positionMm: number; normalizedIntensity: number }[];
}

export interface WaveExperimentRun { actionId: string; parameters: WaveOpticsParameters; projection: WaveOpticsProjection }
export interface SavedWaveExperiment { predictionSubmitted: boolean; runs: readonly WaveExperimentRun[] }
