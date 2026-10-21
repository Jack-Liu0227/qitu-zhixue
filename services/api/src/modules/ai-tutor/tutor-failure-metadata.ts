/** Log only structural diagnostics. Error messages may contain private model input. */
export function tutorFailureMetadata(error: unknown) {
  let code = 'UNKNOWN';
  let status: number | undefined;
  if (error && typeof error === 'object') {
    let body: unknown = error;
    if ('getResponse' in error && typeof error.getResponse === 'function') body = error.getResponse();
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
      && /^[A-Z][A-Z0-9_.-]{0,79}$/.test(body.code)) code = body.code;
    if ('status' in error && typeof error.status === 'number' && error.status >= 100 && error.status <= 599) status = error.status;
  }
  return { code, status, name: error instanceof Error ? error.name : 'UnknownError',
    frames: error instanceof Error ? error.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).map(line => line.trim()) : undefined };
}
