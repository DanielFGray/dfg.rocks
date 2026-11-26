# Gallery photos

Photos published on the home page gallery section.

## Adding a photo

1. Put the file in this directory, named in kebab-case: `lesson-drums.jpg`.
2. Add an entry to `gallery.photos` in `app/config.ts`:
   - `src` — the path from this directory, such as `/gallery/lesson-drums.jpg`.
   - `alt` — what is in the photo, for screen readers and for the image if it fails to load.
   - `caption` — the short line under the photo.
   - `consent` — `parent` if the student's parent agreed to the photo being public,
     `teacher` if you took the photo.

The gallery section renders the entries in the order they appear in the config file.

## Before committing a photo

Compress it. Phone photos are usually 3 to 8 MB, which is far more than a web page needs:

```bash
magick lesson-drums.jpg -resize '1600x1600>' -quality 82 lesson-drums.jpg
```

For a large photo set, WebP is smaller again and every browser supports it:

```bash
magick lesson-drums.jpg -resize '1600x1600>' -quality 80 lesson-drums.webp
```

If you use WebP, change the `src` in the config to match the file extension.

## Removing a photo

Delete the file and its entry in `app/config.ts`. The section shrinks to the remaining photos.
