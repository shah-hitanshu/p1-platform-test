import React from 'react';
import { Button, InlineMessage, Modal, TextInput } from '@pantheon-systems/pds-toolkit-react';
import type { AttachedFile } from '../../types.js';
import {
  AttachmentGoneError,
  AttachmentRejectedError,
  type MediaField,
} from '../../lib/attachments/mediaApi.js';
import styles from './AttachmentModal.module.css';

export interface AttachmentModalProps {
  file: AttachedFile;
  onClose: () => void;
  /** Fetches a kept file's bytes. Absent when nothing is set up to keep them. */
  loadFile?: (assetId: string) => Promise<Blob>;
  /** Adds a kept image to the site's media library. Absent when that is not possible. */
  addToLibrary?: (assetId: string, metadata: Record<string, string>) => Promise<void>;
  /** The details the library records, so the form asks for what its own upload asks for. */
  libraryFields?: () => Promise<MediaField[]>;
  /** Whether the image is already a library asset, which is what makes the offer honest. */
  isInLibrary?: (assetId: string) => Promise<boolean>;
}

/**
 * PDS centres `.pds-modal` with `margin: auto`, but floating-ui's overlay has no flex, so the
 * vertical auto margins resolve to zero and a tall modal sits at the top of the screen.
 *
 * Inline rather than in the stylesheet with everything else: PDS sets `top: 5%` inline too,
 * and a class cannot outrank that. Modal spreads `...props` after its own `style`, so this
 * replaces PDS's rather than merging — its reveal transition goes with it, and
 * `contentMaxHeight` cannot be used alongside it, so the body carries its own cap.
 */
const centredStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

type Loaded =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'image'; src: string }
  | { status: 'text'; text: string }
  | { status: 'failed' };

/** Inline files never consult this — `body` returns before the switch — so they stay idle. */
export function initialPreview(
  file: AttachedFile,
  loadFile?: (assetId: string) => Promise<Blob>,
): Loaded {
  if (file.dataUrl !== undefined || file.text !== undefined) return { status: 'idle' };
  return file.assetId !== undefined && loadFile ? { status: 'loading' } : { status: 'idle' };
}

/**
 * A sent file at page size. Files from this session are still in memory; a turn reopened later
 * carries only a reference, and its file is fetched when the modal opens rather than with the
 * transcript, which would fire one authenticated request per card on load.
 */
export function AttachmentModal({
  file,
  onClose,
  loadFile,
  addToLibrary,
  libraryFields,
  isInLibrary,
}: AttachmentModalProps): React.ReactElement {
  const inline = file.dataUrl !== undefined || file.text !== undefined;
  // 'idle' renders the terminal "not kept" notice, and the effect below only reaches
  // 'loading' after the first commit — one painted frame of the wrong answer.
  const [loaded, setLoaded] = React.useState<Loaded>(() => initialPreview(file, loadFile));
  // Set only when the file itself cannot be fetched. A library deletion leaves the
  // conversation's copy readable, so it does not set this.
  const [gone, setGone] = React.useState(false);
  // null while the lookup is outstanding, so the action stays hidden instead of flickering
  // between "add" and "already there".
  const [inLibrary, setInLibrary] = React.useState<boolean | null>(isInLibrary ? null : false);

  React.useEffect(() => {
    if (inline || file.assetId === undefined || !loadFile) return undefined;
    const assetId = file.assetId;
    let objectUrl: string | null = null;
    let live = true;

    setLoaded({ status: 'loading' });
    void (async () => {
      try {
        const blob = await loadFile(assetId);
        if (!live) return;
        if (file.kind === 'image') {
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ status: 'image', src: objectUrl });
        } else {
          setLoaded({ status: 'text', text: await blob.text() });
        }
      } catch (err) {
        if (!live) return;
        if (err instanceof AttachmentGoneError) setGone(true);
        else setLoaded({ status: 'failed' });
      }
    })();

    return () => {
      live = false;
      // The blob is held alive by the URL, not by the element that used it.
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [inline, file.assetId, file.kind, loadFile]);

  React.useEffect(() => {
    const assetId = file.assetId;
    // Must mirror the render gate below: for a document this lookup's answer is never read.
    if (file.kind !== 'image' || assetId === undefined || !isInLibrary || addToLibrary === undefined) {
      return undefined;
    }
    let live = true;
    // A failed lookup is not an answer, so offer the action and let the write decide.
    void isInLibrary(assetId).then(
      present => { if (live) setInLibrary(present); },
      () => { if (live) setInLibrary(false); },
    );
    return () => { live = false; };
  }, [file.assetId, file.kind, isInLibrary, addToLibrary]);

  return (
    <Modal
      title={file.filename}
      modalIsOpen
      setModalIsOpen={(isOpen: boolean) => { if (!isOpen) onClose(); }}
      hasCloseButton
      closeButtonLabel="Close preview"
      size="l"
      style={centredStyle}
    >
      <div className={styles.shell}>
        <div className={styles.preview}>
          {gone ? <p className={styles.notice}>This file is no longer available.</p> : body(file, loaded)}
        </div>
        {/* Hidden rather than disabled for text: a greyed control is a question with no answer. */}
        {file.kind === 'image' && file.assetId !== undefined && addToLibrary !== undefined
          && !gone && inLibrary !== null && (
          <AddToLibrary
            assetId={file.assetId}
            addToLibrary={addToLibrary}
            libraryFields={libraryFields}
            present={inLibrary}
            onGone={() => setGone(true)}
          />
        )}
      </div>
    </Modal>
  );
}

function body(file: AttachedFile, loaded: Loaded): React.ReactElement {
  if (file.dataUrl !== undefined) return <Picture src={file.dataUrl} alt={file.filename} />;
  // Pre-wrapped, not rendered: formatting it would show something other than what the
  // agent was given.
  if (file.text !== undefined) return <pre className={styles.text}>{file.text}</pre>;

  switch (loaded.status) {
    case 'image':
      return <Picture src={loaded.src} alt={file.filename} />;
    case 'text':
      return <pre className={styles.text}>{loaded.text}</pre>;
    case 'loading':
      return <p className={styles.notice}>Loading…</p>;
    case 'failed':
      return <p className={styles.notice}>This file could not be loaded.</p>;
    default:
      return <p className={styles.notice}>This file was not kept.</p>;
  }
}

function Picture({ src, alt }: { src: string; alt: string }): React.ReactElement {
  return <img src={src} alt={alt} className={styles.picture} />;
}

const GENERIC_FAILURE = 'That did not work. Try again?';

/**
 * What the form asks for when the service cannot say. An image added with no alt text is the
 * one outcome this offer must not produce, and the media picker falls back the same way.
 */
const FALLBACK_FIELDS: MediaField[] = [{ name: 'alt', label: 'Alt text' }];

type Adding =
  | { status: 'idle' }
  | { status: 'details' }
  | { status: 'adding' }
  | { status: 'added' }
  | { status: 'failed'; reason: string };

/**
 * Making a chat attachment a site asset is a write, so nothing here runs on open. An image
 * already in the library says so instead of offering again: the service takes a second
 * promotion as a no-op, so a second form would collect details and drop them.
 *
 * The details are collected first rather than after the fact: every other way into the
 * library asks for them at upload, and an image that lands with no alt text is one nobody
 * is prompted to fix.
 */
function AddToLibrary({
  assetId,
  addToLibrary,
  libraryFields,
  present,
  onGone,
}: {
  assetId: string;
  addToLibrary: (assetId: string, metadata: Record<string, string>) => Promise<void>;
  libraryFields?: () => Promise<MediaField[]>;
  present: boolean;
  onGone: () => void;
}): React.ReactElement {
  const [state, setState] = React.useState<Adding>({ status: 'idle' });
  const [fields, setFields] = React.useState<MediaField[]>([]);
  const [values, setValues] = React.useState<Record<string, string>>({});

  const openDetails = (): void => {
    setState({ status: 'details' });
    if (fields.length > 0) return;
    // Never blocks on the field list, and never renders an empty one: a schema the service
    // cannot supply would otherwise add the image unlabelled with nothing prompting a fix.
    if (!libraryFields) {
      setFields(FALLBACK_FIELDS);
      return;
    }
    void libraryFields().then(
      list => setFields(list.length > 0 ? list : FALLBACK_FIELDS),
      () => setFields(FALLBACK_FIELDS),
    );
  };

  const submit = (): void => {
    setState({ status: 'adding' });
    void addToLibrary(assetId, values).then(
      () => setState({ status: 'added' }),
      (err: unknown) => {
        if (err instanceof AttachmentGoneError) return onGone();
        setState({
          status: 'failed',
          reason: err instanceof AttachmentRejectedError ? err.message : GENERIC_FAILURE,
        });
      },
    );
  };

  if (present || state.status === 'added') {
    return (
      <InlineMessage
        type={state.status === 'added' ? 'success' : 'info'}
        title={state.status === 'added'
          ? 'Added to the media library'
          : 'Already in the media library'}
        message={state.status === 'added' ? undefined : 'Edit its details there.'}
      />
    );
  }

  if (state.status === 'idle') {
    return (
      <div className={styles.actions}>
        <Button label="Add to library" variant="secondary" onClick={openDetails} />
      </div>
    );
  }

  const adding = state.status === 'adding';
  return (
    <div className={styles.form}>
      <p className={styles.formTitle}>Add to the media library</p>
      {state.status === 'failed' && (
        <InlineMessage type="critical" title="Not added" message={state.reason} />
      )}
      <div className={styles.fields}>
        {fields.map(field => (
          <TextInput
            key={field.name}
            id={`add-to-library-${assetId}-${field.name}`}
            label={field.label}
            size="s"
            disabled={adding}
            value={values[field.name] ?? ''}
            onChange={event => {
              const { value } = event.target;
              setValues(current => ({ ...current, [field.name]: value }));
            }}
          />
        ))}
      </div>
      <div className={styles.actions}>
        <Button
          label="Cancel"
          variant="subtle"
          disabled={adding}
          onClick={() => setState({ status: 'idle' })}
        />
        <Button label={adding ? 'Adding…' : 'Add'} disabled={adding} onClick={submit} />
      </div>
    </div>
  );
}
