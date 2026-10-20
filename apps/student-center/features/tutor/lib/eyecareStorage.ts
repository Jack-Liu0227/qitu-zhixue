export const EYECARE_CHANGE_EVENT = 'qitu-eyecare-change';

export function getStoredEyecare(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem('qitu.student.eyecare');
    return saved === '1' || saved === 'true';
  } catch {
    return false;
  }
}

export function setStoredEyecare(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('qitu.student.eyecare', active ? '1' : '0');
    if (active) {
      document.documentElement.setAttribute('data-qitu-eyecare', 'true');
    } else {
      document.documentElement.removeAttribute('data-qitu-eyecare');
    }
    window.dispatchEvent(new CustomEvent(EYECARE_CHANGE_EVENT, { detail: { active } }));
  } catch {
    // ignore
  }
}

export function subscribeEyecare(callback: (active: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ active: boolean }>;
    if (custom.detail && typeof custom.detail.active === 'boolean') {
      callback(custom.detail.active);
    } else {
      callback(getStoredEyecare());
    }
  };
  window.addEventListener(EYECARE_CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EYECARE_CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
