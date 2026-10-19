import { ServiceUnavailableException } from '@nestjs/common';
import { decryptModelSecret, encryptModelSecret } from '../../common/secrets/model-secret';

interface DeviceAuthorization {
  deviceCode: string;
  verificationUriComplete?: string;
}

/** Keep the resumable URL encrypted with its device code, without another credential store. */
export function encryptDeviceAuthorization(value: Required<DeviceAuthorization>, key: Buffer): string {
  return encryptModelSecret(JSON.stringify({ version: 1, ...value }), key);
}

export function decryptDeviceAuthorization(ciphertext: string, key: Buffer): DeviceAuthorization {
  try {
    const plaintext = decryptModelSecret(ciphertext, key);
    // Older sessions encrypted only the opaque device code; they can still be polled.
    if (!plaintext.startsWith('{')) return { deviceCode: plaintext };
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.deviceCode !== 'string' || !value.deviceCode
      || typeof value.verificationUriComplete !== 'string' || !value.verificationUriComplete) throw new Error('Invalid device authorization');
    return { deviceCode: value.deviceCode, verificationUriComplete: value.verificationUriComplete };
  } catch {
    throw new ServiceUnavailableException('Feishu device authorization cannot be decrypted');
  }
}
