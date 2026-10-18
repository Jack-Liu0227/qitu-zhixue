'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AiRuntimePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings');
  }, [router]);

  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#1e293b', marginBottom: '8px' }}>
        AI 运行时已解耦拆分
      </h2>
      <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '24px' }}>
        AI 运行时入口已移除，相关能力已拆分到助手、团队、模型、技能与工具设置。
      </p>
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
        <Link href="/settings" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
          设置总览
        </Link>
        <Link href="/settings/teams" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
          团队管理
        </Link>
        <Link href="/settings/model-providers" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
          模型管理
        </Link>
        <Link href="/settings/skills" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
          技能管理
        </Link>
        <Link href="/settings/tools" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
          工具管理
        </Link>
      </div>
    </div>
  );
}
