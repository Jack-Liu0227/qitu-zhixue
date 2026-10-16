"""Export generated frames and assemble a silent, deterministic project film.

Requires Pillow and ffmpeg on PATH. No API calls or credentials are used here.
Usage: python tooling/build-story-film.py [directory-containing-scene-01.png-etc]
"""

import pathlib
import subprocess
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'output/imagegen/project-cases'
DEST = ROOT / 'apps/auth-portal/public/media/project-cases'
DEST.mkdir(parents=True, exist_ok=True)
frame_count = 9
inputs = []
filters = []
for i in range(frame_count):
    source = SOURCE / f'scene-{i + 1:02}.png'
    revised = SOURCE / f'scene-{i + 1:02}-revised.png'
    if revised.is_file():
        source = revised
    if not source.is_file():
        raise SystemExit(f'Missing generated frame: {source}')
    with Image.open(source) as image:
        if image.size != (2048, 1152):
            raise SystemExit(f'Unexpected frame dimensions: {source}')
        image.convert('RGB').save(DEST / f'scene-{i + 1:02}.webp', quality=85, method=6)
    inputs.extend(['-i', str(source)])
    filters.append(
        f'[{i}:v]scale=2560:1440,zoompan=z=1+0.0002*on:'
        f'x=iw/2-iw/zoom/2:y=ih/2-ih/zoom/2:d=100:s=1280x720:fps=30,'
        f'format=yuv420p,settb=AVTB[v{i}]'
    )
last = 'v0'
for i in range(1, frame_count):
    filters.append(f'[{last}][v{i}]xfade=transition=fade:duration=0.35:offset={3 * i:.1f}[x{i}]')
    last = f'x{i}'
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y', *inputs,
    '-filter_complex_threads', '1', '-filter_complex', ';'.join(filters),
    '-map', f'[{last}]', '-an', '-t', '27', '-c:v', 'libx264', '-crf', '23',
    '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    str(DEST / 'story.mp4'),
], check=True)
print(f'Exported {frame_count} WebP frames and story.mp4 to {DEST}')
