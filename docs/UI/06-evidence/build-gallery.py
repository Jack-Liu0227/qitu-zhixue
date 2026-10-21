"""Build the local screenshot index and verify PNG artifacts. No network access."""
from pathlib import Path
import hashlib
import html
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
GROUPS = {
    '00-home': '官网与主页', '01-login': '登录与访问恢复',
    '02-student': '学生端', '03-teacher': '班主任端',
    '04-parent': '家长端', '05-admin': '管理端',
}
metrics = json.loads((ROOT / '06-evidence/browser-metrics.json').read_text(encoding='utf-8'))
items = []
for path in sorted(ROOT.glob('*/*.png')):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    width, height = struct.unpack('>II', data[16:24])
    assert width > 0 and height > 0, path
    items.append({'file': path.relative_to(ROOT).as_posix(), 'width': width,
                  'height': height, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

manifest = {'site': metrics['baseUrl'], 'capturedAt': metrics['capturedAt'],
            'screenshots': len(items), 'routeStateRecords': len(metrics['records']),
            'bytes': sum(item['bytes'] for item in items), 'files': items}
(ROOT / '06-evidence/screenshot-manifest.json').write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

cards = []
for item in items:
    file = item['file']
    group = file.split('/')[0]
    kind = 'mobile' if '-mobile' in file else 'desktop'
    name = Path(file).stem
    cards.append(f'<a class="shot" data-group="{group}" data-kind="{kind}" '
                 f'data-name="{html.escape(name)}" href="{file}" target="_blank" rel="noopener">'
                 f'<div class="preview"><img loading="lazy" src="{file}" alt="{html.escape(name)}"></div>'
                 f'<strong>{html.escape(name)}</strong><small>{GROUPS[group]} · '
                 f'{item["width"]} × {item["height"]}</small></a>')

options = ''.join(f'<option value="{key}">{value}</option>' for key, value in GROUPS.items())
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>启途智学 · UI 审查图库</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#16243a;font:15px/1.6 system-ui,sans-serif}
header{background:#fff;padding:32px max(24px,5vw);border-bottom:1px solid #dbe2ec}
h1{font-size:30px;margin:0 0 8px}p{max-width:1050px;margin:8px 0}a{color:#074ac1}
.tools{position:sticky;top:0;z-index:2;padding:16px 5vw;background:#f3f6faf5;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid #dbe2ec}
select,input{border:1px solid #becbdc;background:white;color:#16243a;border-radius:8px;padding:10px;font:inherit;min-height:44px}
input{flex:1;min-width:180px}#count{padding:10px 0}.grid{padding:24px 5vw;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
.shot{display:block;overflow:hidden;border:1px solid #dbe2ec;border-radius:12px;background:#fff;text-decoration:none;color:inherit}
.preview{height:230px;background:#e8edf5;overflow:hidden;border-bottom:1px solid #dbe2ec}.preview img{width:100%;height:100%;object-fit:cover;object-position:top}
.shot strong,.shot small{display:block;padding:0 14px;overflow-wrap:anywhere}.shot strong{margin-top:12px}.shot small{color:#56677e;margin:4px 0 14px}
.shot:hover{border-color:#155ce4}.shot:focus-visible{outline:3px solid #155ce4;outline-offset:3px}[hidden]{display:none!important}
</style><header><h1>启途智学 · UI 审查图库</h1>
<p>线上视觉审查 · 2026-10-21 · 1440 × 1000 / 390 × 844</p>
<p><a href="体验报告.md">前端体验报告</a> · <a href="优化方案.md">优化方案与验收清单</a> · <a href="README.md">范围与归档说明</a></p>
<p>__TOTAL__ 张截图。点击图片查看原图；预览仅显示图片顶部。section 为官网真实滚动逐屏，scroll 为内部滚动分段。官网长截图可能不显示尚未进入视口的动画卡片，应以 section 图为准。灰块及对话区留白是隐私遮蔽，不是界面缺陷。</p>
</header><div class="tools"><select id="group" aria-label="客户端"><option value="">全部客户端</option>__OPTIONS__</select>
<select id="kind" aria-label="视口"><option value="">全部视口</option><option value="desktop">桌面</option><option value="mobile">手机宽度</option></select>
<input id="search" placeholder="搜索文件名，如 tutor / templates / offline" aria-label="搜索截图"><span id="count" aria-live="polite"></span></div>
<main class="grid">__CARDS__</main><script>
const group=document.querySelector('#group'),kind=document.querySelector('#kind'),search=document.querySelector('#search');
function update(){let count=0;document.querySelectorAll('.shot').forEach(el=>{el.hidden=!!((group.value&&el.dataset.group!==group.value)||(kind.value&&el.dataset.kind!==kind.value)||(search.value&&!el.dataset.name.toLowerCase().includes(search.value.toLowerCase())));if(!el.hidden)count++;});document.querySelector('#count').textContent=count+' 张';}
[group,kind,search].forEach(el=>el.addEventListener('input',update));update();
</script></html>'''
page = page.replace('__TOTAL__', str(len(items))).replace('__OPTIONS__', options).replace('__CARDS__', '\n'.join(cards))
(ROOT / 'index.html').write_text(page, encoding='utf-8')

for group, title in GROUPS.items():
    records = [r for r in metrics['records'] if r['folder'] == group]
    files = [i for i in items if i['file'].startswith(group + '/')]
    lines = [f'# {title}截图索引', '', '[返回总览](../README.md) · [打开图库](../index.html)', '',
             f'{len(files)} 张截图。桌面视口 1440×1000，手机视口 390×844；长图和元素截图的实际高度不同。', '',
             '## 页面与路由', '', '| 页面文件前缀 | 请求路由 | 最终路由 |', '|---|---|---|']
    for r in records:
        lines.append(f'| `{r["slug"]}` | `{r["path"]}` | `{r["resolvedPath"]}` |')
    lines += ['', '## 全部截图', '', '| 文件 | 尺寸 |', '|---|---|']
    for item in files:
        name = Path(item['file']).name
        lines.append(f'| [{name}]({name}) | {item["width"]} × {item["height"]} |')
    (ROOT / group / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

print(json.dumps({'screenshots': len(items), 'routeStates': len(metrics['records']),
                  'sizeMiB': round(manifest['bytes'] / 1024**2, 1),
                  'groups': {g: sum(i['file'].startswith(g + '/') for i in items) for g in GROUPS}}))
