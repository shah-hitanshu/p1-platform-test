import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

export interface NavIconProps {
  iconName: string;
  tooltip?: string;
}

/** `l` is 20px — the size the rest of the rail's icons render at. `m` (16px)
 *  left this tab visibly smaller than the tabs beside it. */
export function NavIcon({ iconName }: NavIconProps): React.ReactElement {
  return <Icon iconName={iconName as never} size="l" />;
}
