/**
 * SafeIcon
 *
 * pds-toolkit's `Icon` reads its icon-data entry and dereferences it without a
 * guard, so an icon name it does not ship throws a TypeError instead of
 * rendering nothing. Consumers pin their own pds-toolkit version and the icon
 * set is not stable across releases — `link` became `linkSimple` and
 * `squareDashed` was dropped — so a name that resolves here can be absent in a
 * site's build.
 *
 * An icon in a block's outline row is decorative, but an uncaught throw during
 * render unmounts the whole editor, and it does so on every load of any
 * document containing that block. This renders nothing rather than letting one
 * missing glyph cost the page.
 */

import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

export interface SafeIconProps {
  /** Any pds-toolkit icon name. Unknown names render nothing. */
  iconName: string;
  size?: 's' | 'm' | 'l';
}

interface BoundaryState {
  failed: boolean;
}

class IconBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function SafeIcon({ iconName, size = 's' }: SafeIconProps): React.ReactElement {
  return (
    <IconBoundary key={iconName}>
      <Icon iconName={iconName as never} size={size} />
    </IconBoundary>
  );
}
