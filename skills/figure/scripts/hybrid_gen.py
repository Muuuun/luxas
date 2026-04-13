#!/usr/bin/env python3
"""Generate an isolated raster component via Gemini (Nano Banana) → remove
background via rembg → save transparent PNG.

Used by the illustrator agent's hybrid figure pipeline.

CLI:
  python hybrid_gen.py --name tweezer --prompt "..." --style "..." --out assets/tweezer.png

Requires GEMINI_API_KEY. The raw (pre-rembg) image is saved alongside as
<out_stem>_raw.png for debugging.
"""
import argparse
import base64
import os
import sys
from pathlib import Path


def generate(prompt: str, out_path: Path, model: str, remove_bg: bool) -> bool:
    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not set", file=sys.stderr)
        return False

    client = genai.Client(api_key=api_key)
    resp = client.models.generate_content(model=model, contents=prompt)

    raw_path = out_path.with_name(out_path.stem + "_raw.png")
    for part in resp.candidates[0].content.parts:
        data = getattr(getattr(part, "inline_data", None), "data", None)
        if not data:
            continue
        if isinstance(data, str):
            data = base64.b64decode(data)
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_bytes(data)
        break
    else:
        text = getattr(resp, "text", "") or ""
        print(f"ERROR: no image in response. Text: {text[:300]}", file=sys.stderr)
        return False

    if not remove_bg:
        # Just copy raw → out
        out_path.write_bytes(raw_path.read_bytes())
        print(f"OK (no-rembg): {out_path} ({out_path.stat().st_size // 1024} KB)")
        return True

    # Background removal
    try:
        from PIL import Image
        from rembg import remove
    except ImportError as e:
        print(f"ERROR: rembg/Pillow not installed ({e}). Run: pip install -r skills/figure/scripts/requirements.txt", file=sys.stderr)
        return False

    img = Image.open(raw_path)
    cut = remove(img)
    cut.save(out_path)
    # If rembg over-aggressively stripped the whole image (cut size ≪ raw size),
    # fall back to the raw image — useful for shiny metal/silver objects.
    raw_kb = raw_path.stat().st_size / 1024
    cut_kb = out_path.stat().st_size / 1024
    if cut_kb < raw_kb * 0.1:
        print(f"WARN: rembg cut seems too aggressive ({cut_kb:.0f} KB vs raw {raw_kb:.0f} KB). Using raw instead.", file=sys.stderr)
        out_path.write_bytes(raw_path.read_bytes())
        print(f"OK (raw fallback): {out_path}")
        return True

    print(f"OK: {out_path} ({cut_kb:.0f} KB; raw kept at {raw_path.name})")
    return True


def main():
    ap = argparse.ArgumentParser(description="Gemini Nano Banana + rembg component generator")
    ap.add_argument("--name", required=True, help="Component short name (for logs)")
    ap.add_argument("--prompt", required=True, help="Object description — NO text, NO labels")
    ap.add_argument("--style", default="", help="Shared style suffix (lighting, palette, aspect)")
    ap.add_argument("--out", required=True, help="Output PNG path (transparent after rembg)")
    ap.add_argument("--model", default="gemini-2.5-flash-image", help="Gemini image model")
    ap.add_argument("--no-rembg", action="store_true", help="Skip background removal")
    args = ap.parse_args()

    default_style = (
        "Isolated object on pure white background, no text, no labels, "
        "no captions, no shadows on the ground, centered, square 1024x1024, "
        "flat scientific illustration, soft top-left lighting."
    )
    style_suffix = args.style or default_style
    full_prompt = f"{args.prompt}\n\n{style_suffix}"

    out_path = Path(args.out)
    ok = generate(full_prompt, out_path, args.model, remove_bg=not args.no_rembg)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
