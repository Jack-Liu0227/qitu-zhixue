export interface AuthLoginResponse {
  id: string;
  email: string;
  displayName: string;
  role: 'student' | 'parent' | 'teacher' | 'admin' | 'support';
}
