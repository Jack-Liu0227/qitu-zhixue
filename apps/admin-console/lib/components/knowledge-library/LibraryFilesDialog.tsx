'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BaseDetail } from '../../api/knowledge-center';
import { LibraryFiles } from './LibraryFiles';
import { Glyph } from './shared';
import styles from './KnowledgeLibrary.module.css';

export function LibraryFilesDialog({
  detail,
  online,
  onClose,
}: {
  detail: BaseDetail;
  online: boolean;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className={`${styles.root} ${styles.overlay}`}>
      <div
        ref={panel}
        className={`${styles.modal} ${styles.filesDialog}`}
        role="dialog"
        aria-modal="true"
        aria-label={`查看文件 ${detail.name}`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0],
            last = controls[controls.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2>{detail.name}</h2>
            <p>已有文件 · 只读查看</p>
          </div>
          <button className={styles.iconButton} aria-label="关闭文件查看" onClick={onClose}>
            <Glyph name="close" />
          </button>
        </header>
        <LibraryFiles key={detail.id} detail={detail} online={online} />
      </div>
    </div>,
    document.body,
  );
}
