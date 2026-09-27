import { createApiClient } from '@qitu/api-client';
import type {
  GuardianLinkListPageData,
  MentorAssignmentListPageData,
  CreateGuardianLinkRequest,
  UpdateGuardianLinkRequest,
  EndGuardianLinkRequest,
  GuardianLinkMutationResponse,
  CreateMentorAssignmentRequest,
  EndMentorAssignmentRequest,
  TransferMentorRequest,
  MentorAssignmentMutationResponse,
  TransferMentorResponse,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

export async function fetchGuardianLinks(): Promise<GuardianLinkListPageData> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<GuardianLinkListPageData>>(
      '/api/v1/admin/guardian-links',
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function createGuardianLink(
  request: CreateGuardianLinkRequest,
  idempotencyKey: string,
): Promise<GuardianLinkMutationResponse> {
  const client = createApiClient('');

  try {
    const response = await client.post<DataEnvelope<GuardianLinkMutationResponse>>(
      '/api/v1/admin/guardian-links',
      request,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function updateGuardianLink(
  linkId: string,
  request: UpdateGuardianLinkRequest,
  idempotencyKey: string,
): Promise<GuardianLinkMutationResponse> {
  const client = createApiClient('');

  try {
    const response = await client.patch<DataEnvelope<GuardianLinkMutationResponse>>(
      `/api/v1/admin/guardian-links/${encodeURIComponent(linkId)}`,
      request,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function endGuardianLink(
  linkId: string,
  request: EndGuardianLinkRequest,
  idempotencyKey: string,
): Promise<GuardianLinkMutationResponse> {
  const client = createApiClient('');

  try {
    const response = await client.post<DataEnvelope<GuardianLinkMutationResponse>>(
      `/api/v1/admin/guardian-links/${encodeURIComponent(linkId)}/end`,
      request,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function fetchMentorAssignments(): Promise<MentorAssignmentListPageData> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<MentorAssignmentListPageData>>(
      '/api/v1/admin/mentor-assignments',
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function createMentorAssignment(
  request: CreateMentorAssignmentRequest,
  idempotencyKey: string,
): Promise<MentorAssignmentMutationResponse> {
  const client = createApiClient('');

  try {
    const response = await client.post<DataEnvelope<MentorAssignmentMutationResponse>>(
      '/api/v1/admin/mentor-assignments',
      request,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function endMentorAssignment(
  assignmentId: string,
  request: EndMentorAssignmentRequest,
  idempotencyKey: string,
): Promise<MentorAssignmentMutationResponse> {
  const client = createApiClient('');

  try {
    const response = await client.post<DataEnvelope<MentorAssignmentMutationResponse>>(
      `/api/v1/admin/mentor-assignments/${encodeURIComponent(assignmentId)}/end`,
      request,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function transferMentor(
  request: TransferMentorRequest,
  idempotencyKey: string,
): Promise<TransferMentorResponse> {
  const client = createApiClient('');

  try {
    const response = await client.post<DataEnvelope<TransferMentorResponse>>(
      '/api/v1/admin/mentor-assignments/transfer',
      request,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}
