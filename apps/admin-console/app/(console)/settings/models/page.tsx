import { redirect } from 'next/navigation';

/**
 * Legacy compatibility route. Model slots were replaced by the provider-first
 * registry: configure a provider, pull its models, then bind usage.
 */
export default function LegacyModelSlotsPage() {
  redirect('/settings/model-providers');
}
