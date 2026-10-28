// The type recorded (and served) for an uploaded file. The browser's claim is
// only kept when it matches the extension family; anything else is stored as a
// download (application/octet-stream), so a renamed file can't be served as
// something active. Pure: used by the server and by the browser upload helper.

const EXT_TYPES: Record<string, RegExp> = {
  pdf: /^application\/pdf$/, png: /^image\/png$/, jpg: /^image\/jpeg$/, jpeg: /^image\/jpeg$/, gif: /^image\/gif$/, webp: /^image\/webp$/,
  avif: /^image\/avif$/, bmp: /^image\/bmp$/,
  txt: /^text\/plain/, csv: /^text\/(csv|plain)/, md: /^text\/(markdown|plain)/, json: /^application\/json/,
  docx: /officedocument\.wordprocessingml/, xlsx: /officedocument\.spreadsheetml/, pptx: /officedocument\.presentationml/,
  doc: /msword/, xls: /ms-excel/, ppt: /ms-powerpoint/, zip: /zip/,
  // Video and audio the in-app viewer plays (files over 4 MB are usually these).
  mp4: /^video\/mp4$/, mov: /^video\/quicktime$/, webm: /^(video|audio)\/webm$/, ogg: /^(video|audio)\/ogg$/,
  mp3: /^audio\/mpeg$/, wav: /^audio\/(x-)?wav$/, m4a: /^audio\/(mp4|x-m4a)$/, aac: /^audio\/aac$/,
};

export function safeContentType(file: { name: string; type: string }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const claimed = (file.type || "").toLowerCase();
  return EXT_TYPES[ext]?.test(claimed) ? claimed : "application/octet-stream";
}
