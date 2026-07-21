/**
 * PresenceStack component.
 *
 * Renders a horizontal stack of actor avatars using PDS Avatar, up to
 * maxVisible, then shows an overflow badge ("+N") for any remaining actors.
 * Each avatar shows a tooltip with the actor's name; the overflow badge
 * shows a tooltip listing all actor names.
 */

import React from 'react';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { Avatar, Tooltip } from '@pantheon-systems/pds-toolkit-react';
import { getAvatarStyleOverride } from '../../collaboration/utils/avatarColor.js';
import styles from './PresenceStack.module.css';

export type { ActorPresence };

export interface PresenceStackProps {
  actors: ActorPresence[];
  maxVisible?: number;
}

export function PresenceStack({ actors, maxVisible = 3 }: PresenceStackProps): React.JSX.Element {
  if (actors.length === 0) {
    return <div className={styles.stack} />;
  }

  const visibleActors = actors.slice(0, maxVisible);
  const overflowCount = actors.length - visibleActors.length;
  const allNames = actors.map((a) => a.name).join('\n');

  return (
    <div className={styles.stack}>
      {visibleActors.map((actor) => (
        <div
          key={actor.id}
          className={styles.avatarWrapper}
          style={getAvatarStyleOverride(actor.actorId)}
        >
          <Tooltip
            content={actor.name}
            preferredPlacement="top"
            customTrigger={
              actor.avatar ? (
                <div
                  data-testid="presence-avatar"
                  className="pds-avatar pds-avatar--sm pds-avatar--image"
                >
                  <span className="pds-avatar__content">
                    <img
                      alt={actor.name}
                      className="pds-avatar__image"
                      src={actor.avatar}
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
                  </span>
                </div>
              ) : (
                <Avatar
                  uniqueId={actor.actorId}
                  hasUserFallback
                  size="s"
                  data-testid="presence-avatar"
                />
              )
            }
          />
        </div>
      ))}
      {overflowCount > 0 && (
        <div className={styles.overflowWrapper}>
          <Tooltip
            content={allNames}
            preferredPlacement="top"
            customTrigger={
              <span data-testid="presence-overflow" className={styles.overflow}>
                +{overflowCount}
              </span>
            }
          />
        </div>
      )}
    </div>
  );
}
