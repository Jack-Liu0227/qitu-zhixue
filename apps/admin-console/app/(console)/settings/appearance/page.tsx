'use client';

import { useEffect, useState } from 'react';
import {
  applyAccountPreferences,
  getStoredEyecareTone,
  getStoredMediaFilter,
  setStoredEyecareTone,
  setStoredMediaFilter,
  useAccountPreferences,
} from '@qitu/ui/preferences';
import { eyecareTones, type EyecareToneId } from '@qitu/design-tokens';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

const THEME_NAMES = {
  default: '默认明亮',
  focus: '专注高对比',
  calm: '舒缓青绿',
  eyecare: '护眼模式',
} as const;

const FONT_SIZE_NAMES = {
  sm: '小号字体 (93.75%)',
  md: '标准字体 (100%)',
  lg: '大号字体 (112.5%)',
} as const;

export default function AppearanceSettingsPage() {
  const { preferences, setPreference } = useAccountPreferences();
  const [currentTone, setCurrentTone] = useState<EyecareToneId>('beige');
  const [mediaFilter, setMediaFilter] = useState(true);

  useEffect(() => {
    setCurrentTone(getStoredEyecareTone());
    setMediaFilter(getStoredMediaFilter());
  }, []);

  const handleToggleTheme = () => {
    const sequence: Array<'default' | 'eyecare' | 'calm' | 'focus'> = ['default', 'eyecare', 'calm', 'focus'];
    const currentIndex = sequence.indexOf(preferences.theme as any);
    const nextTheme = sequence[(currentIndex + 1) % sequence.length];
    setPreference({ theme: nextTheme });
  };

  const handleToggleEyecare = () => {
    const next = preferences.theme === 'eyecare' ? 'default' : 'eyecare';
    setPreference({ theme: next });
    if (next === 'eyecare') {
      applyAccountPreferences({ ...preferences, theme: 'eyecare' });
    }
  };

  const handleCycleTone = () => {
    const tones: EyecareToneId[] = ['beige', 'bean', 'mint', 'dark'];
    const nextTone = tones[(tones.indexOf(currentTone) + 1) % tones.length] ?? 'beige';
    setStoredEyecareTone(nextTone);
    setCurrentTone(nextTone);
    if (preferences.theme !== 'eyecare') {
      setPreference({ theme: 'eyecare' });
    } else {
      applyAccountPreferences({ ...preferences, theme: 'eyecare' });
    }
  };

  const handleToggleMediaFilter = () => {
    const next = !mediaFilter;
    setStoredMediaFilter(next);
    setMediaFilter(next);
    if (preferences.theme === 'eyecare') {
      applyAccountPreferences({ ...preferences, theme: 'eyecare' });
    }
  };

  const handleToggleFontSize = () => {
    const sequence: Array<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg'];
    const currentIndex = sequence.indexOf(preferences.fontSize);
    const nextSize = sequence[(currentIndex + 1) % sequence.length];
    setPreference({ fontSize: nextSize });
  };

  const handleReset = () => {
    setPreference({ theme: 'default', fontSize: 'md', reducedMotion: false });
    setStoredEyecareTone('beige');
    setStoredMediaFilter(true);
    setCurrentTone('beige');
    setMediaFilter(true);
  };

  const activeTone = eyecareTones[currentTone] ?? eyecareTones.beige;

  return (
    <AionSettingsParadigm
      title="外观与护眼设置"
      description="管理四端（学生、教师、家长、管理后台）的视觉色彩、护眼模式（暖米色/豆沙绿/青豆绿/柔夜灰）、字号与动效偏好。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="重置默认"
      onPrimaryAction={handleReset}
    >
      <RowCard
        avatarText="🌿"
        name="护眼模式总开关"
        statusText={preferences.theme === 'eyecare' ? `已开启 (${activeTone.label})` : '未开启'}
        statusType={preferences.theme === 'eyecare' ? 'ok' : 'muted'}
        description="全端应用温润护眼色调，文字采用深灰非纯黑（#3A3A3A / #4A4A4A），对比度完全满足 WCAG AA（≥4.5:1）标准。"
        editLabel={preferences.theme === 'eyecare' ? '切回明亮' : '启用护眼模式'}
        onEdit={handleToggleEyecare}
      />
      <RowCard
        avatarText="🎨"
        name="护眼底色档位"
        statusText={`${activeTone.label} (${activeTone.code})`}
        statusType="custom"
        description="提供 4 档经典护眼底色：暖米色 (#F5F0E1，暖羊皮纸)、豆沙绿 (#E8F0E3)、青豆绿 (#C7EDCC) 与柔夜灰 (#1A202A)。"
        editLabel="轮换底色"
        onEdit={handleCycleTone}
      />
      <RowCard
        avatarText="🖼️"
        name="图片与视频柔光滤镜"
        statusText={mediaFilter ? '已开启防眩光' : '原图无滤镜'}
        statusType={mediaFilter ? 'ok' : 'muted'}
        description="自动为页面中的所有插图和视频叠加微暖柔光滤镜 (filter: sepia(0.1) brightness(0.95))，降低屏幕眩光与高光刺眼感。"
        editLabel={mediaFilter ? '关闭滤镜' : '开启滤镜'}
        onEdit={handleToggleMediaFilter}
      />
      <RowCard
        avatarText="🌈"
        name="多主题预设色彩"
        statusText={THEME_NAMES[preferences.theme as keyof typeof THEME_NAMES] ?? preferences.theme}
        statusType="custom"
        description="系统提供「默认」、「护眼模式」、「舒缓青绿」与「专注高对比」四套设计令牌预设。"
        editLabel="轮换主题"
        onEdit={handleToggleTheme}
      />
      <RowCard
        avatarText="🔤"
        name="界面排版字号"
        statusText={FONT_SIZE_NAMES[preferences.fontSize]}
        statusType="ok"
        description="动态调节四端全局字号缩放比例，适应不同视力习惯与屏幕分辨率。"
        editLabel="切换字号"
        onEdit={handleToggleFontSize}
      />
      <RowCard
        avatarText="✨"
        name="界面动效减弱"
        statusText={preferences.reducedMotion ? '已减弱' : '标准动效'}
        statusType={preferences.reducedMotion ? 'ok' : 'muted'}
        description="当开启时将大幅缩短过渡动画与跳动特效，提供更平静的沉浸学习与办公视野。"
        editLabel={preferences.reducedMotion ? '恢复动效' : '减弱动效'}
        onEdit={() => setPreference({ reducedMotion: !preferences.reducedMotion })}
      />
    </AionSettingsParadigm>
  );
}
