# Gallery photos

Photos published on the home page gallery section.

The gallery shows no text: no heading, no caption, no alt text. It is a wall of photos, and the
photos keep their own shape, so none of them is cropped.

## The layout

The first photo in `gallery.photos` leads: on a wide screen it spans the full width, with the
remaining photos in a grid below it. On a narrow screen every photo stacks.

## Adding a photo

1. Put the file in this directory, named in kebab-case: `lesson-guitar.webp`.
2. Add an entry to `gallery.photos` in `app/config.ts`:
   - `src` — the path from this directory, such as `/gallery/lesson-guitar.webp`.
   - `width` and `height` — the pixel size of the file. The browser reserves the right space
     before the file arrives, so the page does not jump as the photos load.
3. To move a photo to the front, put its entry first in the list.

## Before committing a photo

Compress it. Phone photos are usually 3 to 8 MB, which is far more than a web page needs:

```bash
magick lesson-guitar.jpg -resize '1600x1600>' -quality 80 lesson-guitar.webp
```

WebP is smaller than JPEG again and every browser supports it. Keep the long edge at 1600px or
less; the photos are shown at most half the page width.

## Removing a photo

Delete the file and its entry in `app/config.ts`. The section shrinks to the remaining photos.
