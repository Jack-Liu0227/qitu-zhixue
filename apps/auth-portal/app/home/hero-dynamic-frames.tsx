'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import story from './storyboard.json';

/** The film is decorative; its story remains readable with playback disabled. */
export function HeroDynamicFrames() {
  const container = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const visible = useRef(false);
  const [chapter, setChapter] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [intent, setIntent] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const syncPlayback = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (enabled && intent && !reduced && !offline && !failed && visible.current && !document.hidden) {
      void element.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setIntent(false);
        setPlaying(false);
      });
    } else {
      element.pause();
    }
  }, [enabled, intent, reduced, offline, failed]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const updateMotion = () => {
      const prefersStill = media.matches || document.documentElement.dataset.qituReducedMotion === 'true';
      setReduced(prefersStill);
      if (prefersStill) setEnabled(false);
    };
    updateMotion();
    setEnabled(!media.matches && document.documentElement.dataset.qituReducedMotion !== 'true' && !connection?.saveData);
    const updateNetwork = () => setOffline(!navigator.onLine);
    updateNetwork();
    media.addEventListener('change', updateMotion);
    const observer = new MutationObserver(updateMotion);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-qitu-reduced-motion'] });
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      media.removeEventListener('change', updateMotion);
      observer.disconnect();
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    syncPlayback();
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = Boolean(entry?.isIntersecting);
      syncPlayback();
    }, { threshold: .15 });
    if (container.current) observer.observe(container.current);
    document.addEventListener('visibilitychange', syncPlayback);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [syncPlayback]);

  const selectChapter = (index: number) => {
    setChapter(index);
    setIntent(false);
    if (video.current && video.current.readyState >= 1) video.current.currentTime = story.scenes[index]!.start + .7;
  };
  const current = story.scenes[chapter]!;
  const still = !enabled || failed || offline;

  return (
    <figure ref={container} className="story-film" aria-label={story.title}>
      <div className="story-film-picture">
        {still && <Image src={current.image} alt={current.alt} width={2048} height={1152} priority={chapter === 0} />}
        <video
          ref={video}
          hidden={still}
          src={enabled && !offline ? story.video : undefined}
          poster={story.scenes[0]!.image}
          aria-label="校园雨水花园项目：六幅生成分镜合成的无声故事短片"
          muted loop playsInline preload={enabled ? 'metadata' : 'none'}
          onPlay={() => setPlaying(true)}
          onPause={() => { setPlaying(false); setWaiting(false); }}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={syncPlayback}
          onError={() => {
            if (video.current?.getAttribute('src')) { setFailed(true); setPlaying(false); }
          }}
          onTimeUpdate={() => {
            if (!enabled || failed || offline || reduced) return;
            const time = video.current?.currentTime ?? 0;
            let index = 0;
            story.scenes.forEach((scene, i) => { if (time >= scene.start) index = i; });
            setChapter(index);
          }}
        />
        <span className="story-film-label">一个问题的六个时刻</span>
        <button
          type="button"
          className="story-film-play"
          disabled={reduced || offline}
          aria-label={intent && enabled && !failed ? '暂停故事短片' : '播放故事短片'}
          onClick={() => {
            if (intent && enabled && !failed) setIntent(false);
            else {
              if (failed) video.current?.load();
              setFailed(false); setEnabled(true); setIntent(true);
            }
          }}
        >{reduced ? '静态模式' : playing ? '暂停' : '播放'}</button>
      </div>
      <figcaption className="story-film-caption">
        <p className="story-film-stage">{current.label}</p>
        <h3>{current.title}</h3>
        <p>{current.description}</p>
      </figcaption>
      <nav className="story-film-chapters" aria-label="选择故事章节">
        {story.scenes.map((scene, index) => (
          <button key={scene.id} type="button" aria-current={chapter === index ? 'step' : undefined}
            onClick={() => selectChapter(index)}>
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{scene.label}
          </button>
        ))}
      </nav>
      <p className="story-film-note" role="status">
        {offline ? '当前离线，可继续阅读分镜。' : failed ? '视频暂时无法播放，可选择章节阅读分镜，或点播放重试。' : waiting && intent && enabled ? '正在缓冲短片，可随时选择章节。' : reduced ? '已遵循减弱动态效果偏好，可逐章阅读。' : '生成分镜合成 · 27 秒 · 无声故事示意，非真实学生记录'}
      </p>
    </figure>
  );
}
