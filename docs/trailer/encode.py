# Pack rendered PNG frames into an animated WebP (Pillow).
# usage: python3 encode.py <framesDir> <out.webp> <quality> <fps> <scale> [method]
import sys, glob, time
from PIL import Image
src, out, q, fps, scale = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
method = int(sys.argv[6]) if len(sys.argv) > 6 else 4
files = sorted(glob.glob(src + '/f*.png'))
step = round(24 / fps)
files = files[::step]
frames = []
for f in files:
    im = Image.open(f).convert('RGB')
    if scale != 1: im = im.resize((round(1280 * scale), round(720 * scale)), Image.LANCZOS)
    frames.append(im)
t = time.time()
frames[0].save(out, save_all=True, append_images=frames[1:], duration=round(1000 * step / 24), loop=0, quality=q, method=method)
import os
print(out, len(frames), 'frames', round(os.path.getsize(out) / 1e6, 2), 'MB', round(time.time() - t, 1), 's')
