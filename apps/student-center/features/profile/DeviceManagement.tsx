'use client';

import { useCallback, useEffect, useState } from 'react';

interface DeviceSession {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '未知时间';
}

export function DeviceManagement() {
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/auth/sessions', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('设备列表加载失败');
      const payload = (await response.json()) as { data?: DeviceSession[] };
      setDevices(Array.isArray(payload.data) ? payload.data : []);
      setError('');
    } catch {
      setError('设备列表暂时无法加载，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(id: string): Promise<void> {
    setRevoking(id);
    try {
      const response = await fetch('/api/v1/auth/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError('退出设备失败，请稍后重试。');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section style={{ marginTop: 24, padding: 20, border: '1px solid #dce8f7', borderRadius: 12, background: '#fff' }} aria-labelledby="student-device-sessions">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <h2 id="student-device-sessions" style={{ margin: 0, color: '#102a5c', fontSize: 18 }}>登录设备</h2>
          <p style={{ margin: '6px 0 0', color: '#73839b', fontSize: 13 }}>最多同时登录两台设备。退出不用的设备后，才能登录新设备。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} style={{ border: '1px solid #c6d7ee', background: '#fff', color: '#2878f0', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>刷新</button>
      </div>
      {error ? <p role="alert" style={{ color: '#b42318', fontSize: 13 }}>{error}</p> : null}
      {loading ? <p style={{ color: '#73839b', fontSize: 13 }}>正在加载设备…</p> : null}
      {!loading && devices.length === 0 ? <p style={{ color: '#73839b', fontSize: 13 }}>暂无设备会话。</p> : null}
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {devices.map((device) => (
          <div key={device.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #edf2f8' }}>
            <div>
              <strong style={{ color: '#1e3557', fontSize: 14 }}>{device.deviceName} {device.current ? '（当前设备）' : ''}</strong>
              <div style={{ color: '#73839b', fontSize: 12, marginTop: 4 }}>最近活动：{formatTime(device.lastSeenAt)}</div>
            </div>
            {!device.current ? <button type="button" onClick={() => void revoke(device.id)} disabled={revoking === device.id} style={{ border: '1px solid #efb4b4', background: '#fff7f7', color: '#b42318', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>{revoking === device.id ? '退出中…' : '退出设备'}</button> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
