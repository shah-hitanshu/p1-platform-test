/**
 * CollaboratorAvatars Component
 *
 * Displays stacked avatars of collaborators with tooltips showing names/intents.
 */

import React from 'react';
import type { ActorPresence } from '@pantheon/css-client';
import { getAvatarColor } from '../../utils/avatarColor.js';

export interface CollaboratorAvatarsProps {
  /** List of actors to display */
  actors: ActorPresence[];
  /** Maximum avatars to show before "+N" (default: 5) */
  maxVisible?: number;
  /** Show agents separately from humans */
  separateAgents?: boolean;
  /** Click handler for avatar */
  onAvatarClick?: (actor: ActorPresence) => void;
  /** Custom className */
  className?: string;
}

const baseClass = 'css-puck-collaborator-avatars';

/**
 * Get initials from a name (first letter of first two words).
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/**
 * Build tooltip text for an actor.
 */
function getTooltip(actor: ActorPresence): string {
  const parts = [actor.name];
  if (actor.role === 'agent' && actor.intent) {
    parts.push(`Intent: ${actor.intent}`);
  }
  if (actor.state) {
    parts.push(`Status: ${actor.state}`);
  }
  return parts.join('\n');
}

/**
 * Renders a single avatar.
 */
function Avatar({
  actor,
  onClick,
}: {
  actor: ActorPresence;
  onClick?: (actor: ActorPresence) => void;
}) {
  const isEditing = actor.state === 'editing';
  const isAgent = actor.role === 'agent';

  const avatarClasses = [
    `${baseClass}__avatar`,
    isEditing && `${baseClass}__avatar--editing`,
    isAgent && `${baseClass}__avatar--agent`,
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = () => {
    onClick?.(actor);
  };

  // Generate a consistent color based on the actor's actual ID (not presence record ID)
  // This ensures colors match the demo UserSwitcher and are consistent across sessions
  const backgroundColor = getAvatarColor(actor.actorId);

  return (
    <div
      className={avatarClasses}
      style={{ backgroundColor }}
      data-tooltip={getTooltip(actor)}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      {actor.avatar ? (
        <img
          src={actor.avatar}
          alt={actor.name}
          className={`${baseClass}__image`}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
        />
      ) : (
        <span className={`${baseClass}__initials`}>{getInitials(actor.name)}</span>
      )}
      {isAgent && <span className={`${baseClass}__agent-badge`} aria-hidden="true" />}
    </div>
  );
}

/**
 * Displays stacked avatars of collaborators with tooltips showing names/intents.
 * Automatically updates based on usePresence hook.
 */
export function CollaboratorAvatars({
  actors,
  maxVisible = 5,
  separateAgents = false,
  onAvatarClick,
  className,
}: CollaboratorAvatarsProps): React.JSX.Element {
  if (actors.length === 0) {
    return <div className={[baseClass, className].filter(Boolean).join(' ')} />;
  }

  const humans = actors.filter((a) => a.role === 'human');
  const agents = actors.filter((a) => a.role === 'agent');

  // Determine which actors to display
  let displayActors: ActorPresence[];
  let overflowCount: number;

  if (separateAgents) {
    // Show humans first, then separator, then agents
    const visibleHumans = humans.slice(0, Math.ceil(maxVisible / 2));
    const visibleAgents = agents.slice(0, Math.floor(maxVisible / 2));
    displayActors = [...visibleHumans, ...visibleAgents];
    overflowCount = actors.length - displayActors.length;
  } else {
    displayActors = actors.slice(0, maxVisible);
    overflowCount = actors.length - maxVisible;
  }

  const containerClasses = [baseClass, className].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      {separateAgents ? (
        <>
          <div className={`${baseClass}__group`}>
            {humans.slice(0, Math.ceil(maxVisible / 2)).map((actor) => (
              <Avatar key={actor.id} actor={actor} onClick={onAvatarClick} />
            ))}
          </div>
          {agents.length > 0 && (
            <>
              <div className={`${baseClass}__separator`} />
              <div className={`${baseClass}__group`}>
                {agents.slice(0, Math.floor(maxVisible / 2)).map((actor) => (
                  <Avatar key={actor.id} actor={actor} onClick={onAvatarClick} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        displayActors.map((actor) => (
          <Avatar key={actor.id} actor={actor} onClick={onAvatarClick} />
        ))
      )}
      {overflowCount > 0 && (
        <div className={`${baseClass}__overflow`}>+{overflowCount}</div>
      )}
    </div>
  );
}
