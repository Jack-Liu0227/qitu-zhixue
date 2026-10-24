export const FEEDBACK_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const FEEDBACK_ATTACHMENT_MAX_COUNT = 5;
export const FEEDBACK_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'] as const;
export type FeedbackAttachmentContentType = typeof FEEDBACK_ATTACHMENT_TYPES[number];
export interface FeedbackAttachmentInfo {
  id: string;
  fileName: string;
  contentType: FeedbackAttachmentContentType;
  sizeBytes: number;
  createdAt: string;
}
export interface UploadFeedbackAttachmentRequest {
  childId: string;
  fileName: string;
  contentType: FeedbackAttachmentContentType;
  base64: string;
}
