import { describe, it, expect, vi, afterEach } from 'vitest';
import { dataUrlBytes, downscaleImage, fitWithin } from '../src/lib/attachments/downscaleImage.js';
import { AttachmentError } from '../src/lib/attachments/attachmentError.js';

/**
 * happy-dom implements neither `createImageBitmap` nor canvas encoding, so both are stood in
 * for. What is being asserted is the decision-making — the size chosen, the refusals — not the
 * browser's imaging.
 */
function stubImaging(options: {
  bitmap?: { width: number; height: number };
  dataUrl?: string;
  decodeFails?: boolean;
} = {}): {
  drawn: { width: number; height: number }[];
  closed: () => number;
  encodeArgs: unknown[][];
  canvases: { width: number; height: number }[];
} {
  const drawn: { width: number; height: number }[] = [];
  const encodeArgs: unknown[][] = [];
  const canvases: { width: number; height: number }[] = [];
  let closes = 0;

  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (options.decodeFails) throw new Error('decode failed');
    return { ...(options.bitmap ?? { width: 2048, height: 1024 }), close: () => { closes += 1; } };
  }));

  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = { width: 0, height: 0 } as unknown as HTMLCanvasElement & { width: number; height: number };
    canvases.push(canvas);
    canvas.getContext = (() => ({
      drawImage: (_bitmap: unknown, _x: number, _y: number, width: number, height: number) => {
        drawn.push({ width, height });
      },
    })) as unknown as HTMLCanvasElement['getContext'];
    canvas.toDataURL = ((...args: unknown[]) => {
      encodeArgs.push(args);
      return options.dataUrl ?? 'data:image/webp;base64,QUJD';
    }) as unknown as HTMLCanvasElement['toDataURL'];
    return canvas;
  }) as typeof document.createElement);

  return { drawn, closed: () => closes, encodeArgs, canvases };
}

const file = (): File => new File(['bytes'], 'hero.png', { type: 'image/png' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fitWithin', () => {
  it('scales the long edge down and keeps the aspect ratio', () => {
    expect(fitWithin(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 256, height: 1024 });
  });

  it('leaves an image already small enough alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1024, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it('never rounds an edge away to nothing', () => {
    expect(fitWithin(10_000, 3)).toEqual({ width: 1024, height: 1 });
  });
});

describe('dataUrlBytes', () => {
  it('measures the payload without decoding it', () => {
    expect(dataUrlBytes(`data:image/webp;base64,${btoa('hello')}`)).toBe(5);
    expect(dataUrlBytes(`data:image/webp;base64,${btoa('hi')}`)).toBe(2);
    expect(dataUrlBytes(`data:image/webp;base64,${btoa('abcd')}`)).toBe(4);
  });
});

describe('downscaleImage', () => {
  it('draws the image at the reduced size and encodes it as WebP', async () => {
    const imaging = stubImaging({ bitmap: { width: 3000, height: 1500 } });

    const dataUrl = await downscaleImage(file());

    expect(imaging.drawn).toEqual([{ width: 1024, height: 512 }]);
    expect(imaging.encodeArgs[0]).toEqual(['image/webp', 0.8]);
    expect(dataUrl).toBe('data:image/webp;base64,QUJD');
  });

  it('releases the decoded bitmap, even when encoding fails', async () => {
    const ok = stubImaging();
    await downscaleImage(file());
    expect(ok.closed()).toBe(1);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const bad = stubImaging({ dataUrl: 'data:,' });
    await expect(downscaleImage(file())).rejects.toBeInstanceOf(AttachmentError);
    expect(bad.closed()).toBe(1);
  });

  it('releases the canvas backing store, even when encoding fails', async () => {
    const ok = stubImaging();
    await downscaleImage(file());
    expect(ok.canvases.map(c => [c.width, c.height])).toEqual([[0, 0]]);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const bad = stubImaging({ dataUrl: 'data:,' });
    await expect(downscaleImage(file())).rejects.toBeInstanceOf(AttachmentError);
    expect(bad.canvases.map(c => [c.width, c.height])).toEqual([[0, 0]]);
  });

  it('reports an image the browser cannot decode', async () => {
    stubImaging({ decodeFails: true });

    await expect(downscaleImage(file())).rejects.toThrow(/could not be read/);
  });

  it('accepts whatever image type the browser fell back to', async () => {
    stubImaging({ dataUrl: 'data:image/png;base64,QUJD' });

    expect(await downscaleImage(file())).toBe('data:image/png;base64,QUJD');
  });

  it('refuses a re-encoded image that is still enormous', async () => {
    stubImaging({ dataUrl: `data:image/webp;base64,${'A'.repeat(6 * 1024 * 1024)}` });

    await expect(downscaleImage(file())).rejects.toThrow(/too detailed/);
  });
});
