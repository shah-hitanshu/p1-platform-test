import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

export interface NavIconProps {
  iconName: string;
  tooltip?: string;
}

export function NavIcon({ iconName }: NavIconProps): React.ReactElement {
  return <Icon iconName={iconName as never} iconSize="m" />;
}
