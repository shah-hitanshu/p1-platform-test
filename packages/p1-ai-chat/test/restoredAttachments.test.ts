import { describe, it, expect } from 'vitest';
import { EMPTY_STATE, restoreHistory } from '../src/lib/session/chatState.js';
import type { RestoredMessage } from '../src/types.js';

const replay = (attachments: unknown): ReturnType<typeof restoreHistory> =>
  restoreHistory(EMPTY_STATE, [
    { role: 'user', content: 'look at this', attachments } as unknown as RestoredMessage,
  ]);

const filesOf = (state: ReturnType<typeof restoreHistory>) => state.messages[0]?.attachments ?? [];

describe('a replayed turn s stored file references', () => {
  it('keeps a well-formed reference so the file can be fetched back', () => {
    expect(filesOf(replay([{ kind: 'image', filename: 'shot.png', assetId: 'aB3-9_x' }]))).toEqual([
      { kind: 'image', filename: 'shot.png', assetId: 'aB3-9_x' },
    ]);
  });

  /**
   * The reference becomes a path segment in a request the panel makes. It arrived over the
   * socket, so it is checked here rather than trusted — the same reason this whole object
   * is rebuilt field by field instead of passed through.
   */
  it('refuses anything that could not be a safe path segment, keeping the card', () => {
    for (const hostile of ['../../secrets', 'a/b', 'x?y=1', 'a b', '', 'x'.repeat(65), 7, null, {}]) {
      const [file] = filesOf(replay([{ kind: 'image', filename: 'shot.png', assetId: hostile }]));
      // The turn still shows it carried a file; only the ability to reopen it is dropped.
      expect(file).toEqual({ kind: 'image', filename: 'shot.png' });
    }
  });

  it('still drops a payload a replayed turn claims, reference or not', () => {
    const [file] = filesOf(replay([{
      kind: 'image', filename: 'shot.png', assetId: 'ok-1',
      dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', text: 'not from us',
    }]));
    expect(file).toEqual({ kind: 'image', filename: 'shot.png', assetId: 'ok-1' });
  });
});
