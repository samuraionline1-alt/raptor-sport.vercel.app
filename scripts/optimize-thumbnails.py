"""Optional asset regeneration; requires Pillow. Normal builds use committed WebP files."""
from pathlib import Path
from PIL import Image
import json
root = Path(__file__).resolve().parent.parent
manifest_path = root / 'data/image-optimization.json'
manifest = json.loads(manifest_path.read_text())
for filename, data in manifest.items():
    if not any(v['width'] == 320 for v in data['variants']):
        continue
    image = Image.open(root / filename)
    image.thumbnail((320, 320), Image.Resampling.LANCZOS)
    output = root / 'assets/optimized' / (Path(filename).stem + '-320.webp')
    image.save(output, 'WEBP', quality=78, method=6)
    for variant in data['variants']:
        if variant['width'] == 320:
            variant['bytes'] = output.stat().st_size
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
image = Image.open(root / 'raptor-sport-hero-bg.jpeg')
width, height = image.size
image = image.crop(((width-512)//2, 0, (width+512)//2, height))
image.thumbnail((256, 768), Image.Resampling.LANCZOS)
image.save(root / 'assets/optimized/raptor-sport-hero-mobile.webp', 'WEBP', quality=72, method=6)
