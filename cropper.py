import sys
from PIL import Image

def auto_crop(img_path):
    img = Image.open(img_path).convert("RGBA")
    bbox = img.getbbox()
    if bbox:
        # Add a tiny 2% padding so it doesn't hit the absolute edges
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        pad = int(max(w, h) * 0.02)
        new_bbox = (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(img.width, bbox[2] + pad),
            min(img.height, bbox[3] + pad)
        )
        img = img.crop(new_bbox)
    
    img.save("/Volumes/EXTERNAL/01_DEV_PROJECTS/MyApps/fb-post-summarizer/icon_cropped.png", "PNG")

if __name__ == "__main__":
    auto_crop(sys.argv[1])
    print("OK")
