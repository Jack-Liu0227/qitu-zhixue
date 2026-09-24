export interface AnalyticsEvent {
  name: string;
  occurredAt: string;
  properties?: Record<string, string | number | boolean>;
}
