const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * The files on the clipboard, each with a name — a pasted screenshot often arrives without one,
 * and the name is what the card shows and what the agent is told the image is called.
 *
 * Reads `files` rather than `items`: copying part of a web page puts an HTML flavour on the
 * clipboard with no file, and only `files` tells that apart from pasting an image.
 */
export function clipboardFiles(data: { files?: ArrayLike<File> | null } | null): File[] {
  return Array.from(data?.files ?? []).map((file, index) =>
    file.name === '' ? nameForPaste(file, index) : file,
  );
}

function nameForPaste(file: File, index: number): File {
  const extension = PASTED_IMAGE_EXTENSIONS[file.type] ?? 'bin';
  const suffix = index === 0 ? '' : `-${String(index + 1)}`;
  return new File([file], `pasted-image${suffix}.${extension}`, { type: file.type });
}
