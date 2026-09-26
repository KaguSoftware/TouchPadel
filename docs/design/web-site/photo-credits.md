# Website photo credits

The five photographs on the public site (`apps/web/src/assets/photos/*.jpg`) are **licensed stock
placeholders**. None of them shows Touch Padel, its courts, its café or its people, and no caption
or alt text may say it does. Each one is to be replaced with Touch's own photograph as soon as
there is one. The file name and the 3:2 size (2400 × 1600) stay the same, so the page does not
need to change.

Both licences allow free commercial use with no attribution required. We record the credits
anyway so each image can be traced and replaced.

- **Unsplash License:** <https://unsplash.com/license>. Only free-licence photos are used here,
  never **Unsplash+**, which is a paid licence.
- **Pexels License:** <https://www.pexels.com/license/>

Fetched **2026-09-23**. All five were processed the same way by one script: a crop to 3:2, a
resize to 2400 × 1600, and one shared cool "night-court" grade. The grade takes saturation out of
warm tones (loud oranges lose the most; skin tones lose only a little), boosts blues slightly,
boosts the yellow-green ball slightly, pushes the shadows toward navy, makes the highlights a
little cooler and adds a gentle contrast curve. The script also strips all metadata
(EXIF/XMP/IPTC/ICC) and exports a progressive mozjpeg with 4:2:0 chroma. Quality is 80, lowered
in steps only as far as needed to keep each file at or under 450 KiB.

---

## hero.jpg

- **Source:** <https://unsplash.com/photos/a-man-holding-a-tennis-racquet-on-a-tennis-court-aYTK2HNocNw>
  (image `photo-1646649851800-48dba35edc76`)
- **Photographer:** Vincenzo Morelli ([@vincenzomorelli](https://unsplash.com/@vincenzomorelli)).
  The Unsplash description credits the shoot as "Ph: Emanuela D'Ambrosi". Napoli, Italy, 2022.
- **Licence:** Unsplash License, <https://unsplash.com/license>
- **Fetched:** 2026-09-23
- **Changes:** the full 3:2 frame is kept (15945 × 10629 → 2400 × 1600). Brightness is lowered 6%
  so a white headline holds on the turf, then the shared cool grade is applied. JPEG q70,
  459,746 bytes.
- **Cropping on the page:** use `object-position: 50% 15%`. With that, the 16:9 desktop crop keeps
  both the player's head and the ball, and the 4:5 phone crop keeps both the player and the ball.
- Placeholder — replace with Touch's own photograph.

## club.jpg

- **Source:** <https://unsplash.com/photos/a-blue-tiled-floor-with-a-white-line-in-the-middle-3sSbRisCnmE>
  (image `photo-1658491830143-72808ca237e3`)
- **Photographer:** Oskar Hagberg ([@knosk](https://unsplash.com/@knosk)). Ledap Arena, Sollentuna,
  Sweden, 2022.
- **Licence:** Unsplash License, <https://unsplash.com/license>
- **Fetched:** 2026-09-23
- **Changes:** a 3:2 band taken from 6% down the frame (5776 × 4336 → 5776 × 3851 → 2400 × 1600),
  then the shared cool grade. JPEG q80, 398,780 bytes.
- Placeholder — replace with Touch's own photograph.

## lessons.jpg

- **Source:** <https://www.pexels.com/photo/woman-playing-padel-tennis-indoors-35248332/>
- **Photographer:** Anhelina Vasylyk ([Pexels profile](https://www.pexels.com/@anhelina-vasylyk-734724285/))
- **Licence:** Pexels License, <https://www.pexels.com/license/>
- **Fetched:** 2026-09-23
- **Changes:** the original is portrait (4000 × 6000). A landscape 3:2 band was taken from 20% down
  the frame, running from the ball to the player's shoulders (4000 × 2667 → 2400 × 1600). The
  shared cool grade then mutes the orange roof beams. JPEG q80, 314,744 bytes.
- Placeholder — replace with Touch's own photograph.

## cafe.jpg

- **Source:** <https://www.pexels.com/photo/elegant-cappuccino-in-a-dark-ambience-31106210/>
- **Photographer:** Vishnu Panday ([Pexels profile](https://www.pexels.com/@vishnu-panday-94089132/))
- **Licence:** Pexels License, <https://www.pexels.com/license/>
- **Fetched:** 2026-09-23
- **Changes:** a 3:2 band taken from 10% down the frame (5232 × 4000 → 5232 × 3488 → 2400 × 1600),
  then the shared cool grade. JPEG q80, 201,444 bytes.
- Placeholder — replace with Touch's own photograph.

## events.jpg

- **Source:** <https://unsplash.com/photos/a-man-and-woman-shaking-hands-on-a-tennis-court-ZO4pHKtpn4c>
  (image `photo-1646649852033-7e0f3d679f8b`)
- **Photographer:** Vincenzo Morelli ([@vincenzomorelli](https://unsplash.com/@vincenzomorelli)).
  The description credits "Ph: Emanuela D'Ambrosi". Napoli, Italy, 2022.
- **Licence:** Unsplash License, <https://unsplash.com/license>
- **Fetched:** 2026-09-23
- **Changes:** the full 3:2 frame is kept (15945 × 10629 → 2400 × 1600), then the shared cool grade,
  which also tones down the orange shoes. JPEG q72, 450,691 bytes.
- Placeholder — replace with Touch's own photograph.

---

**Rejected on purpose:** a Pexels set that was shot at another Iraqi club (Vibora Club, Baghdad),
because it would show a competitor's venue. Aerial photos of multi-court outdoor complexes were
also rejected, because Touch has two *indoor* courts. Unsplash+ images were excluded because the
licence is paid. Every tennis, badminton or clay-court frame was excluded, even when it was tagged
"padel".
