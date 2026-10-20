import { ApiError, createApiClient } from '@qitu/api-client';
import type { StudentProfileProjection } from './types';

export class ProfileOfflineError extends Error {}
export class ProfilePermissionError extends Error {}

export async function loadStudentProfile(baseUrl = ''): Promise<StudentProfileProjection> {
  try {
    const response = await createApiClient(baseUrl).get<{ data: StudentProfileProjection }>(
      '/api/v1/students/me/profile',
    );
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      throw new ProfilePermissionError('Unable to view this student profile');
    }
    if ((error instanceof ApiError && error.status === 0) || error instanceof TypeError) {
      throw new ProfileOfflineError('Profile is unavailable while offline');
    }
    throw error;
  }
}
