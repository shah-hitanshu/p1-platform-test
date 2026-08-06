/**
 * PresenceStack component.
 *
 * Renders a horizontal stack of actor avatars, up to maxVisible, then shows an
 * overflow badge ("+N") for any remaining actors. Each avatar shows a tooltip
 * with the actor's name; the overflow badge lists the hidden actors' names.
 *
 */

import React from 'react';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { Avatar, Tooltip } from '@pantheon-systems/pds-toolkit-react';
import { getAvatarColor } from '../../collaboration/utils/avatarColor.js';
import { getInitials } from '../../collaboration/utils/initials.js';
import styles from './PresenceStack.module.css';

export type { ActorPresence };

export interface PresenceStackProps {
  actors: ActorPresence[];
  maxVisible?: number;
  showActiveDot?: boolean;
}

/** ActorState is 'active' | 'idle' | 'editing' — 'idle' is present but not live. */
function isLive(actor: ActorPresence): boolean {
  return actor.state === 'active' || actor.state === 'editing';
}

function ActorAvatar({ actor }: { actor: ActorPresence }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFailedUrl(null);
  }, [actor.avatar]);

  const initials = getInitials(actor.name);

  if (actor.avatar && actor.avatar !== failedUrl) {
    return (
      <div data-testid="presence-avatar" className="pds-avatar pds-avatar--image">
        <span className="pds-avatar__content">
          <img
            key={actor.avatar}
            alt={actor.name}
            className="pds-avatar__image"
            src={actor.avatar}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            onError={() => setFailedUrl(actor.avatar ?? null)}
          />
        </span>
      </div>
    );
  }

  if (initials) {
    return (
      <div
        data-testid="presence-avatar"
        className={`pds-avatar ${styles.initials}`}
        style={{ backgroundColor: getAvatarColor(actor.actorId) }}
      >
        {initials}
      </div>
    );
  }

  return <Avatar uniqueId={actor.actorId} hasUserFallback size="s" data-testid="presence-avatar" />;
}

function OverflowBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <span data-testid="presence-overflow" className={styles.overflow}>
      +{count}
    </span>
  );
}

export function PresenceStack({
  actors,
  maxVisible = 3,
  showActiveDot = false,
}: PresenceStackProps): React.JSX.Element {
  if (actors.length === 0) {
    return <div className={styles.stack} />;
  }

  const visibleActors = actors.slice(0, maxVisible);
  const overflowCount = actors.length - visibleActors.length;
  const hiddenNames = actors
    .slice(maxVisible)
    .map((a) => a.name)
    .filter(Boolean)
    .join(', ');

  const stackingOrder = [...visibleActors].reverse();

  return (
    <div className={styles.stack}>
      {overflowCount > 0 && (
        <div data-testid="presence-overflow-wrapper" className={styles.overflowWrapper}>
          {hiddenNames ? (
            <Tooltip
              content={hiddenNames}
              preferredPlacement="top"
              customTrigger={<OverflowBadge count={overflowCount} />}
            />
          ) : (
            <OverflowBadge count={overflowCount} />
          )}
        </div>
      )}
      {stackingOrder.map((actor) => {
        const live = isLive(actor);
        return (
        <div
          key={actor.id}
          data-testid="presence-avatar-wrapper"
          className={styles.avatarWrapper}
        >
          {actor.name ? (
            <Tooltip
              content={actor.name}
              preferredPlacement="top"
              customTrigger={<ActorAvatar actor={actor} />}
            />
          ) : (
            <ActorAvatar actor={actor} />
          )}
          {showActiveDot && (
            <span
              data-testid={live ? 'presence-active-dot' : 'presence-idle-dot'}
              className={live ? styles.activeDot : styles.idleDot}
              aria-hidden="true"
            />
          )}
        </div>
        );
      })}
    </div>
  );
}
