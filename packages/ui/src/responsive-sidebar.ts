'use client';

import { useCallback, useEffect, useState } from 'react';

/** Phone drawers never inherit the desktop rail's expanded state. */
export function useResponsiveSidebar(route: string) {
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  useEffect(() => {
    const media = matchMedia('(max-width: 768px)');
    const update = () => {
      setMobile(media.matches);
      setMobileOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [route]);

  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobile, mobileOpen]);

  const toggle = useCallback(() => {
    if (mobile) setMobileOpen((open) => !open);
    else setDesktopCollapsed((collapsed) => !collapsed);
  }, [mobile]);

  return { collapsed: mobile ? !mobileOpen : desktopCollapsed, toggle };
}
