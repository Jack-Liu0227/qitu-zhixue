import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ipaddr from 'ipaddr.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { object, ServiceError, string, type JsonObject } from './ima.js';

const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

export interface Download { bytes: Uint8Array; contentType: string }
export type Downloader = (url: string, headers: Record<string, string>) => Promise<Download>;

export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export function sourceUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ServiceError('UNSAFE_SOURCE', '原文地址不合法。'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new ServiceError('UNSAFE_SOURCE', '原文只支持无账号密码的 HTTPS 标准端口地址。');
  }
  return url;
}

export function createDownloader(maxBytes: number, timeoutMs: number): Downloader {
  return async (raw, headers) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let url = sourceUrl(raw);
    for (let redirect = 0; redirect <= 3; redirect++) {
      // Pin the checked public IP into the actual TLS connection to prevent DNS rebinding.
      const addresses = await new Promise<Awaited<ReturnType<typeof resolveAddresses>>>((resolve, reject) => {
        const abort = () => reject(new ServiceError('SOURCE_TIMEOUT', '原文域名解析超时。'));
        signal.addEventListener('abort', abort, { once: true });
        resolveAddresses(url.hostname).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
      signal.throwIfAborted();
      if (!addresses.length || addresses.some(a => !publicAddress(a.address))) {
        throw new ServiceError('UNSAFE_SOURCE', '原文地址解析到了非公网地址，已拒绝读取。');
      }
      const address = addresses[0]!;
      const result = await new Promise<Download | { location: string }>((resolve, reject) => {
        const req = request(url, {
          method: 'GET', headers, signal, family: address.family,
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        }, res => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
            res.resume();
            resolve({ location: res.headers.location });
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new ServiceError('SOURCE_UNAVAILABLE', '原文暂时无法访问，请使用 ima 客户端查看。'));
            return;
          }
          if (Number(res.headers['content-length']) > maxBytes) {
            res.destroy();
            reject(new ServiceError('FILE_TOO_LARGE', '资料超过服务配置的读取大小上限。'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              reject(new ServiceError('FILE_TOO_LARGE', '资料超过服务配置的读取大小上限。'));
            } else { chunks.push(chunk); }
          });
          res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
          res.on('error', reject);
          res.on('aborted', () => reject(new ServiceError('SOURCE_UNAVAILABLE', '原文传输中断。')));
        });
        req.on('error', reject);
        req.end();
      });
      if ('bytes' in result) return result;
      const next = sourceUrl(new URL(result.location, url).href);
      if (next.origin !== url.origin && Object.keys(headers).length) {
        throw new ServiceError('UNSAFE_REDIRECT', '带鉴权的原文发生跨站跳转，请使用 ima 客户端查看。');
      }
      url = next;
    }
    throw new ServiceError('SOURCE_UNAVAILABLE', '原文跳转次数过多。');
  };
}

export function mediaHeaders(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, v] of Object.entries(object(value))) {
    if (typeof v !== 'string' || /[\r\n]/.test(key + v)) continue;
    if (/^(authorization|cookie|referer|user-agent|accept|x-[a-z0-9-]+)$/i.test(key)) result[key] = v;
  }
  return result;
}

export async function extractPdf(bytes: Uint8Array, startPage: number, pageCount: number, maxChars: number): Promise<JsonObject> {
  const task = getDocument({
    data: new Uint8Array(bytes), disableFontFace: true,
    useSystemFonts: false, useWorkerFetch: false, verbosity: 0,
    cMapUrl: join(pdfRoot, 'cmaps').replaceAll('\\', '/') + '/', cMapPacked: true,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts').replaceAll('\\', '/') + '/',
  });
  try {
    const pdf = await task.promise;
    if (startPage > pdf.numPages) throw new ServiceError('PAGE_OUT_OF_RANGE', `该 PDF 共 ${pdf.numPages} 页。`);
    const endPage = Math.min(pdf.numPages, startPage + pageCount - 1);
    const pages: { page: number; text: string }[] = [];
    let remaining = maxChars;
    let truncated = false;
    for (let n = startPage; n <= endPage; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const full = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').trim();
      const text = full.slice(0, remaining);
      pages.push({ page: n, text });
      remaining -= text.length;
      page.cleanup();
      if (text.length < full.length || (remaining === 0 && n < endPage)) { truncated = true; break; }
    }
    return {
      format: 'pdf_text', total_pages: pdf.numPages, pages, truncated,
      page_numbering: 'PDF 文件页序，从 1 开始，可能与教材印刷页码不同。',
      ...(pages.every(p => !p.text) ? { warning: '这些页没有可提取文字，可能是扫描件；需要额外 OCR。' } : {}),
      formula_note: '文字提取可能丢失公式排版和图形；请依据原文核对，不能据此臆造公式。',
    };
  } finally { await task.destroy(); }
}

function resolveAddresses(hostname: string) {
  return lookup(hostname.replace(/^\[|\]$/g, ''), { all: true });
}

export async function readSource(
  media: JsonObject, download: Downloader, options: { startPage: number; pageCount: number; maxChars: number; offset: number },
): Promise<JsonObject> {
  const urlInfo = object(media.url_info);
  const url = string(urlInfo.url);
  if (!url) return { available: false, message: 'ima 未返回可访问原文，请使用 ima 客户端查看。' };
  sourceUrl(url);
  const { bytes, contentType } = await download(url, mediaHeaders(urlInfo.headers));
  if (Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) {
    return { available: true, ...await extractPdf(bytes, options.startPage, options.pageCount, options.maxChars) };
  }
  if ([7, 13].includes(Number(media.media_type)) || /^text\/(plain|markdown)(;|$)/i.test(contentType)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return {
      available: true, format: 'text', content: text.slice(options.offset, options.offset + options.maxChars),
      offset: options.offset, total_chars: text.length,
      truncated: options.offset + options.maxChars < text.length,
    };
  }
  return { available: false, message: '当前支持 PDF、UTF-8 文本和知识库笔记；该原文类型请在 ima 客户端查看。' };
}
