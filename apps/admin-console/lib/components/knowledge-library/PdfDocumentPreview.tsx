'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import styles from './KnowledgeLibrary.module.css';

/** Render original PDF pages inside the website without the browser download/plugin flow. */
export function PdfDocumentPreview({ url, title }: { url: string; title: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState('fit');
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(null);
    setError('');
    setRenderError('');
    setPage(1);
    setZoom('fit');
    void (async () => {
      try {
        const [pdf, response] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          fetch(url, { credentials: 'include', signal: controller.signal }),
        ]);
        if (!response.ok) {
          throw new Error(
            response.status === 401 || response.status === 403
              ? '登录已失效或没有原文查看权限，请重新登录。'
              : '暂时无法读取 PDF 原文，请重试或切换「提取文本」。',
          );
        }
        if (!response.headers.get('content-type')?.includes('application/pdf')) {
          throw new Error('此来源暂未提供 PDF 原文件，可切换「提取文本」查看。');
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        const assets = `/admin/pdfjs/${pdf.version}/`;
        pdf.GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.min.mjs';
        task = pdf.getDocument({
          data,
          cMapUrl: assets + 'cmaps/',
          cMapPacked: true,
          standardFontDataUrl: assets + 'standard_fonts/',
          wasmUrl: assets + 'wasm/',
        });
        const loaded = await task.promise;
        if (!controller.signal.aborted) setDocument(loaded);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error && e.name === 'PasswordException'
              ? '此 PDF 已加密，请使用未加密版本。'
              : e instanceof Error
                ? e.message
                : '原文读取失败',
          );
      }
    })();
    return () => {
      controller.abort();
      void task?.destroy().catch(() => {});
    };
  }, [url, attempt]);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [document]);

  useEffect(() => {
    const target = canvas.current;
    if (!document || !target || !width) return;
    let cancelled = false;
    let renderingTask: RenderTask | undefined;
    setRendering(true);
    setRenderError('');
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = zoom === 'fit' ? Math.max(0.1, (width - 32) / base.width) : Number(zoom);
        const viewport = pdfPage.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        target.width = Math.floor(viewport.width * ratio);
        target.height = Math.floor(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        const context = target.getContext('2d');
        if (!context) throw new Error('CANVAS_UNAVAILABLE');
        renderingTask = pdfPage.render({
          canvas: target,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await renderingTask.promise;
        if (!cancelled) setRendering(false);
      } catch {
        if (!cancelled) {
          setRendering(false);
          setRenderError('此页暂时无法显示，请重试或切换「提取文本」。');
        }
      }
    })();
    return () => {
      cancelled = true;
      renderingTask?.cancel();
    };
  }, [document, page, width, zoom, attempt]);

  if (error)
    return (
      <div className={styles.empty} role="alert">
        <p>{error}</p>
        <button className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
          重新读取原文
        </button>
      </div>
    );
  if (!document)
    return (
      <div className={styles.empty} role="status">
        正在读取 PDF 原文…
      </div>
    );
  function turnTo(next: number) {
    if (!Number.isInteger(next) || next < 1 || next > document!.numPages) return;
    setPage(next);
    scroll.current?.scrollTo({ top: 0, left: 0 });
  }
  return (
    <section className={styles.pdfReader} aria-label={`${title} 在线 PDF 阅读器`}>
      <div className={styles.pdfToolbar}>
        <div className={styles.pdfPageNav}>
          <button
            type="button"
            aria-label="上一页"
            disabled={page === 1}
            onClick={() => turnTo(page - 1)}
          >
            ‹
          </button>
          <label>
            <input
              aria-label="PDF 页码"
              type="number"
              min={1}
              max={document.numPages}
              value={page}
              onChange={(e) => turnTo(Number(e.target.value))}
            />
            <span> / {document.numPages} 页</span>
          </label>
          <button
            type="button"
            aria-label="下一页"
            disabled={page === document.numPages}
            onClick={() => turnTo(page + 1)}
          >
            ›
          </button>
        </div>
        <select aria-label="PDF 缩放" value={zoom} onChange={(e) => setZoom(e.target.value)}>
          <option value="fit">适应宽度</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
        </select>
      </div>
      <div className={styles.pdfScroll} ref={scroll} aria-busy={rendering}>
        {renderError ? (
          <div className={styles.empty} role="alert">
            <p>{renderError}</p>
            <button className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
              重试
            </button>
          </div>
        ) : (
          <>
            {rendering && (
              <p className={styles.pdfProgress} role="status">
                正在显示第 {page} 页…
              </p>
            )}
            <canvas
              ref={canvas}
              className={styles.pdfCanvas}
              role="img"
              aria-label={`${title} 第 ${page} 页`}
            />
          </>
        )}
      </div>
    </section>
  );
}
