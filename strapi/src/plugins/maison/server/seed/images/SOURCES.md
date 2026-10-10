# Seed image sources

The demo catalog's images live in this folder, and `server/seed/content.json` names each one. All eighteen are photos from [Pexels](https://www.pexels.com/).

## Photos

The photos are used under the [Pexels License](https://www.pexels.com/license/): free to use and modify, and attribution isn't required. The credits are given anyway. Each photo is a 1200 × 1200 px JPEG, the size the generated placeholders had.

| File | Pexels photo page | Photographer | Edit |
| --- | --- | --- | --- |
| `boutique-ginza.jpg` | [Modern Clothing Store in Warsaw Display](https://www.pexels.com/photo/modern-clothing-store-in-warsaw-display-37549254/) | Anna Lupa | None |
| `boutique-omotesando.jpg` | [Modern Office Building in Tokyo in Black and White](https://www.pexels.com/photo/modern-office-building-in-tokyo-in-black-and-white-20472153/) | Tokuo Nobuhiro | None |
| `boutique-osaka.jpg` | [Stunning Osaka Cityscape at Sunset in Japan](https://www.pexels.com/photo/stunning-osaka-cityscape-at-sunset-in-japan-34985872/) | Ariyan | Three areas blurred to hide signs: a pair of lit logos, rooftop lettering and a hotel's name |
| `collection-atelier.jpg` | [Tools and Leather Lying on a Desk in a Leather Crafting Workshop](https://www.pexels.com/photo/tools-and-leather-lying-on-a-desk-in-a-leather-crafting-workshop-4452603/) | Vlada Karpovich | None |
| `collection-gifts.jpg` | [Close-up Shot of Black Gift Boxes](https://www.pexels.com/photo/close-up-shot-of-black-gift-boxes-5872362/) | Max Fischer | None |
| `collection-voyage.jpg` | [Vintage Black Luggage Stack in Cozy Setting](https://www.pexels.com/photo/vintage-black-luggage-stack-in-cozy-setting-36933446/) | Jonathan Borba | None |
| `product-cabin-case-55.jpg` | [Suitcases Beside a Sofa](https://www.pexels.com/photo/suitcases-beside-a-sofa-7368309/) | Vlada Karpovich | None |
| `product-card-case-quatre.jpg` | [Elegant Brown Leather Card Holder on Black Surface](https://www.pexels.com/photo/elegant-brown-leather-card-holder-on-black-surface-33109341/) | Atelier Kommpass | None |
| `product-carnet-wallet.jpg` | [Wood Behind Piece of Leather](https://www.pexels.com/photo/wood-behind-piece-of-leather-12444599/) | Bilakis | None |
| `product-coffret-mini.jpg` | [Photo of a Brown Leather Bag on Black Surface](https://www.pexels.com/photo/photo-of-a-brown-leather-bag-on-black-surface-8502484/) | Hergafi | None |
| `product-garment-carrier.jpg` | [The Bride's and Groom's Clothes Hanging in the Room Ready for the Wedding](https://www.pexels.com/photo/the-brides-and-grooms-clothes-hanging-in-the-room-ready-for-the-wedding-26609406/) | Evlivan Burak | None |
| `product-jewelry-coffret.jpg` | [Boxes with Rings](https://www.pexels.com/photo/boxes-with-rings-16940629/) | Settlemania | None |
| `product-luggage-tag-duo.jpg` | [A Leather Tag Sewn in Fabric](https://www.pexels.com/photo/a-leather-tag-sewn-in-fabric-5813828/) | Tima Miroshnichenko | None |
| `product-passport-cover.jpg` | [Leather Purse and a Car Key Case](https://www.pexels.com/photo/leather-purse-and-a-car-key-case-23371092/) | Beck Galindo | Cropped to leave out a banknote |
| `product-tote-soleil.jpg` | [Photo of Purse with Crocodile Pattern Leather](https://www.pexels.com/photo/photo-of-purse-with-crocodile-pattern-leather-26954381/) | Jose Martin Segura Benites | None |
| `product-voyage-trunk-110.jpg` | [Close-up Shot of Dusty Small Chests](https://www.pexels.com/photo/close-up-shot-of-dusty-small-chests-12860984/) | Jotham Sutharson | None |
| `product-watch-roll-trois.jpg` | [Classic Leather Watch Roll with Timepieces](https://www.pexels.com/photo/classic-leather-watch-roll-with-timepieces-32128448/) | Atelier Kommpass | Every watch dial blurred, to hide brand names |
| `product-weekender-50.jpg` | [Black Leather Bag on White Sofa](https://www.pexels.com/photo/black-leather-bag-on-white-sofa-6773814/) | Rachel Claire | A small woven label blurred |

No photo shows a brand or a recognisable person: labels, dials and signs that carried a name are blurred or cropped out, as the Edit column says. Anyone replacing an image should keep it that way.

## Generated placeholders

None are left: every entry in `content.json` names a photo. `scripts/generate-seed-images.mjs` still draws a gradient placeholder with the name on it for any entry whose file name ends in `.png`, and leaves every other file alone. That is why photos are never saved as `.png`.

## Replacing an image

1. Add the new file here as `.jpg`, `.jpeg` or `.webp`, named like the others (`product-<slug>`, `collection-<slug>` or `boutique-<slug>`). Don't use `.png`: the generator treats every `.png` entry as a placeholder and would draw over it. The seed sets each upload's type from the extension.
2. Point the entry's `image` in `server/seed/content.json` at it, and delete the file it replaces. The unit tests fail if `content.json` names a file that isn't here, or this folder holds a file that `content.json` doesn't name.
3. Add a row to the table above with the Pexels page, the photographer and any edit. For a photo from somewhere else, record its source and license the same way.
4. Keep it free of brands and recognisable people. Check the labels, dials and signs in the frame, and blur or crop whatever shows.
