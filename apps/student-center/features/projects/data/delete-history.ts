import type { StudentHistoryDeleteKind, StudentHistoryDeleteReceipt } from '@qitu/contracts';

/** Both student screens use the same owner-checked permanent deletion contract. */
export async function deleteStudentHistory(kind: StudentHistoryDeleteKind, id: string, key: string): Promise<StudentHistoryDeleteReceipt> {
  let response: Response;
  try { response = await fetch(`/api/v1/student-history/${kind}/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'same-origin', headers: { accept: 'application/json', 'idempotency-key': key },
  }); } catch { throw new Error('网络不可用，未确认删除结果，请联网后重试'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message
      : body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : `删除失败（${response.status}），请重试`;
    throw new Error(message);
  }
  const receipt = body && typeof body === 'object' && 'data' in body ? body.data : null;
  if (!receipt || typeof receipt !== 'object' || !('id' in receipt) || receipt.id !== id || !('kind' in receipt) || receipt.kind !== kind
    || !('deleted' in receipt) || receipt.deleted !== true || !('replayed' in receipt) || typeof receipt.replayed !== 'boolean') {
    throw new Error('删除回执不完整，请刷新核实');
  }
  return { id, kind, deleted: true, replayed: receipt.replayed };
}
