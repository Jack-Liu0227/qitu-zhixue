const SUPPORTED = /\.(?:txt|md|csv|json|py|js|ts|tsx|jsx|css|html)$/iu;
const LIMIT = 10_000;

/** Import only readable content into the existing final-version editor. No code is executed. */
export async function importLessonTextFiles(files: readonly Pick<File, 'name' | 'size' | 'arrayBuffer'>[], current: string): Promise<string> {
  if (!files.length || files.length > 5) throw new Error('每次请选择 1–5 份文本、代码或 CSV 文件。');
  const parts: string[] = [];
  let bytes = 0;
  for (const file of files) {
    if (!SUPPORTED.test(file.name)) throw new Error('当前支持文本、Markdown、代码、JSON 和 CSV。图片、PDF 和视频暂不能作为正文导入。');
    bytes += file.size;
    if (bytes > LIMIT * 4) throw new Error('这些文件过大，请精简后导入；成果正文最多 10000 字符。');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('文件无法按 UTF-8 读取，请另存为 UTF-8 文本后重试。'); }
    if (text.includes('\0')) throw new Error('文件包含二进制内容，请选择文本文件。');
    parts.push(`文件：${file.name.replace(/[\r\n]/gu, ' ').slice(0, 120)}\n${text}`);
  }
  const content = [current.trim(), ...parts].filter(Boolean).join('\n\n');
  if (content.length > LIMIT) throw new Error('合并后的成果超过 10000 字符，请精简正文或文件后重试；没有截断或导入部分文件。');
  return content;
}
