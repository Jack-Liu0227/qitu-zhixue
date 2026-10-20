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
  } catch {
    // ignore
  }
}
