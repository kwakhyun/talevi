import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

// The two pages share an 8-unit gutter. The right page ends in a reply tail.
// Keep all exports on this single master geometry.
const pages = `<path d="M27 28C39 28 50 33 60 41V94C49 85 38 81 27 81C23 81 21 78 21 74V35C21 30 23 28 27 28Z"/><path d="M101 28C89 28 78 33 68 41V96C68 99 71 100 73 98L88 83C99 82 107 74 107 63V35C107 30 105 28 101 28Z"/>`;
const gradient = `<defs><linearGradient id="coral" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FF96A6"/><stop offset=".5" stop-color="#FF718E"/><stop offset="1" stop-color="#EE4F78"/></linearGradient></defs>`;
const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="1024" height="1024">${body}</svg>`;
const icon = wrap(
  `${gradient}<rect width="128" height="128" rx="32" fill="url(#coral)"/><g transform="translate(12.8 12.8) scale(.8)" fill="#FFF8F4">${pages}</g>`,
);
const fullBleed = wrap(
  `${gradient}<rect width="128" height="128" fill="url(#coral)"/><g transform="translate(12.8 12.8) scale(.8)" fill="#FFF8F4">${pages}</g>`,
);
const foreground = wrap(
  `<g transform="translate(21.76 21.76) scale(.66)" fill="#FFF8F4">${pages}</g>`,
);
const mono = wrap(
  `<g transform="translate(21.76 21.76) scale(.66)" fill="#000">${pages}</g>`,
);
const web = "apps/web/public/brand";
const native = "apps/mobile/assets";
await Promise.all([
  mkdir(web, { recursive: true }),
  mkdir(native, { recursive: true }),
]);
await Promise.all([
  writeFile(`${web}/talevi-icon.svg`, icon),
  writeFile("apps/web/public/icon.svg", icon),
  writeFile(`${web}/talevi-mark.svg`, wrap(`<g fill="#FF718E">${pages}</g>`)),
  writeFile(
    `${web}/talevi-mark-white.svg`,
    wrap(`<g fill="#FFF8F4">${pages}</g>`),
  ),
  ...[32, 192, 512, 1024].map((size) =>
    sharp(Buffer.from(icon))
      .resize(size, size)
      .png()
      .toFile(`${web}/talevi-icon-${size}.png`),
  ),
  sharp(Buffer.from(fullBleed))
    .resize(180, 180)
    .removeAlpha()
    .png()
    .toFile(`${web}/talevi-icon-180.png`),
  sharp(Buffer.from(fullBleed))
    .resize(1024, 1024)
    .removeAlpha()
    .png()
    .toFile(`${native}/icon.png`),
  sharp(Buffer.from(foreground))
    .resize(1080, 1080)
    .png()
    .toFile(`${native}/adaptive-icon.png`),
  sharp(Buffer.from(mono))
    .resize(1080, 1080)
    .png()
    .toFile(`${native}/monochrome-icon.png`),
]);
console.log(
  "Talevi vector master, web icons, iOS icon and Android adaptive layers exported.",
);
