import { redirect } from 'next/navigation';

/**
 * Legacy compatibility route. Model slots were replaced by the provider-first
 * registry and AI Runtime: configure a provider, pull its models, then select
 * the model directly on an Agent.
 */
export default function LegacyModelSlotsPage() {
  redirect('/settings/model-providers');
}
