"""Build a local, static index and checksums for the remediation screenshots."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import html
import json
import struct

root = Path(__file__).resolve().parent
groups = {'home': '官网', 'login': '登录', 'student': '学生端', 'teacher': '教师端', 'parent': '家长端', 'admin': 'Admin'}
entries = []
for file in sorted((root / 'after').rglob('*.png')):
    data = file.read_bytes()
    width, height = struct.unpack('>II', data[16:24])
    entries.append({'file': file.relative_to(root).as_posix(), 'group': file.parent.name,
                    'width': width, 'height': height, 'bytes': len(data),
                    'sha256': hashlib.sha256(data).hexdigest()})
(root / 'screenshot-manifest.json').write_text(json.dumps({'createdAt': datetime.now(timezone.utc).isoformat(),
    'count': len(entries), 'source': 'local development services and synthetic UI projections', 'screenshots': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
cards = '\n'.join(f'<a class="card" data-group="{e["group"]}" href="{e["file"]}" target="_blank" rel="noopener">'
    f'<img loading="lazy" src="{e["file"]}" alt="{html.escape(e["file"])}">'
    f'<strong>{html.escape(groups[e["group"]])}</strong><span>{html.escape(Path(e["file"]).name)}</span>'
    f'<small>{e["width"]} × {e["height"]}</small></a>' for e in entries)
options = ''.join(f'<option value="{key}">{value}</option>' for key, value in groups.items())
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>启途智学修复后 UI 图库</title><style>
body{margin:0;padding:24px;background:#f4f7fb;color:#132646;font:16px/1.6 system-ui}header{max-width:1100px;margin:auto}
nav{display:flex;gap:12px;flex-wrap:wrap}select,input{font:inherit;min-height:44px;border:1px solid #cbd5e1;border-radius:8px;padding:0 12px}
main{max-width:1500px;margin:24px auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
.card{display:flex;flex-direction:column;padding:12px;border:1px solid #dde5f0;border-radius:12px;background:white;color:inherit;text-decoration:none;overflow:hidden}
.card img{width:100%;height:300px;object-fit:contain;object-position:top;background:#edf2f8}.card span{font-size:13px;overflow-wrap:anywhere}.card small{color:#566780}
:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.card[hidden]{display:none}</style>
<header><h1>启途智学修复后 UI 图库</h1><p>COUNT 张本地截图。Fixture/Synthetic 为合成投影；未发布生产。</p>
<p><a href="README.md">逐项修复记录</a> · <a href="verification.md">验证说明</a> · <a href="../index.html">原始线上截图</a></p>
<nav><label>客户端 <select id="group"><option value="">全部</option>OPTIONS</select></label><label>文件检索 <input id="query" type="search"></label></nav></header>
<main>CARDS</main><script>const group=document.querySelector('#group'),query=document.querySelector('#query');
function filter(){document.querySelectorAll('.card').forEach(card=>{card.hidden=(group.value&&card.dataset.group!==group.value)||!card.innerText.toLowerCase().includes(query.value.toLowerCase())})}
group.addEventListener('change',filter);query.addEventListener('input',filter);</script></html>'''
(root / 'index.html').write_text(page.replace('COUNT', str(len(entries))).replace('OPTIONS', options).replace('CARDS', cards), encoding='utf-8')
print(f'Indexed {len(entries)} screenshots')
