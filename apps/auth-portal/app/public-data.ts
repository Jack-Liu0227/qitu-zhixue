import type { PublicHomeStats, PublicHomeView } from '@qitu/contracts';

const API_ORIGIN = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';
const HOME_FETCH_TIMEOUT_MS = 3_000;

export const FALLBACK_STATS: PublicHomeStats = {
  learners: 0,
  schools: 0,
  publishedTemplates: 0,
  publishedWorks: 0,
};

export async function loadHomeView(): Promise<{ view: PublicHomeView | null; degraded: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOME_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/public/home`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 60 },
      signal: controller.signal,
    });
    if (!response.ok) return { view: null, degraded: true };
    const payload = (await response.json()) as { data?: PublicHomeView };
    if (payload.data === undefined) return { view: null, degraded: true };
    return { view: payload.data, degraded: false };
  } catch {
    return { view: null, degraded: true };
  } finally {
    clearTimeout(timer);
  }
}
