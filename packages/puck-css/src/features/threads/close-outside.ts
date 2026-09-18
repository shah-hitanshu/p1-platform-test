/**
 * Closes something the moment a pointer goes down anywhere but inside it.
 *
 * The thread is drawn inside the editor's preview frame, while the rest of the editor
 * is in the document around it, so a click in either place has to count. Listening in
 * the capture phase means the click is seen even when whatever was hit swallows it.
 */
export function closeOnPointerDownOutside(inside: HTMLElement, close: () => void): () => void {
  const onPointerDown = (e: Event) => {
    if (!inside.contains(e.target as Node | null)) close();
  };

  const own = inside.ownerDocument;
  const around = own.defaultView?.frameElement?.ownerDocument;
  const documents = around && around !== own ? [own, around] : [own];

  documents.forEach((d) => d.addEventListener('pointerdown', onPointerDown, true));
  return () => {
    documents.forEach((d) => d.removeEventListener('pointerdown', onPointerDown, true));
  };
}
