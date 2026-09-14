/**
 * Lets the `fieldTypes.object` override tell the `fieldLabel` override that a
 * field opted into a collapsible section.
 *
 * Puck renders an object field's label row inside the default object renderer,
 * below where a `fieldTypes` override sits — but it passes the field's whole
 * content as that label's `children`. So the label row itself becomes the
 * disclosure toggle, and no second header is needed. `fieldLabel` is global and
 * receives no field identity, hence this channel.
 */

import { createContext } from 'react';
import type { PropTarget } from '../../features/localization/prop-target.js';

export interface CollapsibleFieldContextValue {
  defaultCollapsed?: boolean;
  /** Fields in the group, so the header can show a count that cannot drift. */
  count?: number;
  /**
   * The group's own prop. Its fields are subfields, which the authority and
   * translatability maps cannot key, so the group holds one setting for them
   * all and its header is where that setting is reached.
   */
  translationTarget?: PropTarget | null;
}

export const CollapsibleFieldContext = createContext<CollapsibleFieldContextValue | null>(null);
