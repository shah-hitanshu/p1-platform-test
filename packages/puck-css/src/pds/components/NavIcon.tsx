import React from 'react';
import { Icon, Tooltip } from '@pantheon-systems/pds-toolkit-react';

export interface NavIconProps {
  iconName: string;
  tooltip: string;
}

export function NavIcon({ iconName, tooltip }: NavIconProps): React.ReactElement {
  return (
    <Tooltip
      content={tooltip}
      customTrigger={<Icon iconName={iconName as never} iconSize="m" />}
      preferredPlacement="right"
    />
  );
}
