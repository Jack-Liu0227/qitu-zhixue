'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const LEGACY_HASH_ROUTES: Record<string, string> = {
  '#top': '/',
  '#pbl': '/learning',
  '#competency': '/competencies',
  '#showcase': '/showcase',
  '#about': '/about',
  '#contact': '/contact',
};

export function LegacyHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const target = LEGACY_HASH_ROUTES[window.location.hash];
    if (target !== undefined) router.replace(target);
  }, [router]);

  return null;
}
