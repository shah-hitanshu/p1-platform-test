import { runWithConnection } from '../db';
import {
  createCheckpoint as createCheckpointDirect,
  revertToCheckpoint as revertToCheckpointDirect,
} from '../services/checkpoint-service';
import type { CheckpointTrigger } from '../types';
import type {
  DocumentSessionEnv,
  SessionInfo,
  SessionOwner,
} from './document-session-types';

/**
 * Create a pre-edit checkpoint for a session owner.
 * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
 */
export async function createSessionPreEditCheckpoint(
  env: DocumentSessionEnv,
  sessionInfo: SessionInfo,
  owner: SessionOwner,
  intent: string,
  trigger: CheckpointTrigger,
  targetRegions: string[],
): Promise<string | undefined> {
  // Phase 6.3: Try direct Hyperdrive first
  if (env.HYPERDRIVE !== undefined) {
    try {
      const result = await runWithConnection(
        env.HYPERDRIVE.connectionString,
        { isHyperdrive: true },
        async () =>
          createCheckpointDirect({
            branchId: sessionInfo.branchId,
            checkpointType: 'session_pre_edit',
            createdById: owner.id,
            createdByType: owner.type,
            description: `Pre-edit checkpoint: ${intent}`,
            trigger,
            affectedRegions: targetRegions,
            forceFullSnapshot: true,
          }),
      );
      console.log(`Created pre-edit checkpoint ${result.checkpoint.id} for ${owner.type} ${owner.id} (direct DB)`);
      return result.checkpoint.id;
    } catch (error) {
      console.warn('Direct DB checkpoint failed, falling back to HTTP:', error);
    }
  }

  // Fallback: HTTP internal API
  if (env.INTERNAL_API_URL === undefined || env.INTERNAL_SECRET === undefined) {
    console.log('Agent checkpoint skipped: no Hyperdrive or internal API configured, using placeholder');
    return `checkpoint-${String(Date.now())}-${Math.random().toString(36).substring(2, 9)}`;
  }

  try {
    const checkpointUrl = `${env.INTERNAL_API_URL}/internal/agent-checkpoint-start`;

    const response = await fetch(checkpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_SECRET,
      },
      body: JSON.stringify({
        branchId: sessionInfo.branchId,
        ownerId: owner.id,
        ownerType: owner.type,
        intent,
        trigger,
        targetRegions,
        forceFullSnapshot: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to create pre-edit checkpoint: ${String(response.status)} ${errorText}`);
      return undefined;
    }

    const rawResult: unknown = await response.json();
    const result = rawResult as { checkpointId: string };
    const { checkpointId } = result;
    console.log(`Created pre-edit checkpoint ${checkpointId} for ${owner.type} ${owner.id}`);
    return checkpointId;
  } catch (error) {
    console.error('Error creating pre-edit checkpoint:', error);
    return undefined;
  }
}

/**
 * Create a post-edit checkpoint for a session owner.
 * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
 */
export async function createSessionPostEditCheckpoint(
  env: DocumentSessionEnv,
  sessionInfo: SessionInfo,
  owner: SessionOwner,
  intent: string,
  preEditCheckpointId: string,
  affectedRegions: string[],
): Promise<string | undefined> {
  // A person's session is deliberate work, so its checkpoints are 'manual'.
  const trigger: CheckpointTrigger = owner.type === 'user' ? 'manual' : 'autonomous';

  // Phase 6.3: Try direct Hyperdrive first
  if (env.HYPERDRIVE !== undefined) {
    try {
      const result = await runWithConnection(
        env.HYPERDRIVE.connectionString,
        { isHyperdrive: true },
        async () =>
          createCheckpointDirect({
            branchId: sessionInfo.branchId,
            checkpointType: 'session_post_edit',
            createdById: owner.id,
            createdByType: owner.type,
            description: `Post-edit checkpoint: ${intent}`,
            trigger,
            affectedRegions,
          }),
      );
      console.log(`Created post-edit checkpoint ${result.checkpoint.id} for ${owner.type} ${owner.id} (direct DB)`);
      return result.checkpoint.id;
    } catch (error) {
      console.warn('Direct DB post-edit checkpoint failed, falling back to HTTP:', error);
    }
  }

  // Fallback: HTTP internal API
  if (env.INTERNAL_API_URL === undefined || env.INTERNAL_SECRET === undefined) {
    console.log('Agent checkpoint skipped: no Hyperdrive or internal API configured');
    return undefined;
  }

  try {
    const checkpointUrl = `${env.INTERNAL_API_URL}/internal/agent-checkpoint-complete`;

    const response = await fetch(checkpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_SECRET,
      },
      body: JSON.stringify({
        branchId: sessionInfo.branchId,
        ownerId: owner.id,
        ownerType: owner.type,
        intent,
        trigger,
        preEditCheckpointId,
        affectedRegions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to create post-edit checkpoint: ${String(response.status)} ${errorText}`);
      return undefined;
    }

    const rawResult: unknown = await response.json();
    const result = rawResult as { checkpointId: string };
    const { checkpointId } = result;
    console.log(`Created post-edit checkpoint ${checkpointId} for ${owner.type} ${owner.id}`);
    return checkpointId;
  } catch (error) {
    console.error('Error creating post-edit checkpoint:', error);
    return undefined;
  }
}

/**
 * Rollback to a pre-edit checkpoint.
 * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
 */
export async function rollbackToSessionCheckpoint(
  env: DocumentSessionEnv,
  _sessionInfo: SessionInfo,
  checkpointId: string,
  owner: SessionOwner,
  reason?: string,
): Promise<boolean> {
  // Phase 6.3: Try direct Hyperdrive first
  if (env.HYPERDRIVE !== undefined) {
    try {
      const result = await runWithConnection(
        env.HYPERDRIVE.connectionString,
        { isHyperdrive: true },
        async () =>
          revertToCheckpointDirect({
            checkpointId,
            createdById: owner.id,
            createdByType: owner.type,
            message: reason,
          }),
      );
      const reverted = String(result.documentsReverted);
      console.log(`Rolled back to checkpoint ${checkpointId}, reverted ${reverted} docs (direct DB)`);
      if (result.documentsSkipped > 0) {
        console.warn(
          `Rollback to checkpoint ${checkpointId} skipped ${String(result.documentsSkipped)} registry document(s)`,
        );
      }
      return true;
    } catch (error) {
      console.warn('Direct DB rollback failed, falling back to HTTP:', error);
    }
  }

  // Fallback: HTTP internal API
  if (env.INTERNAL_API_URL === undefined || env.INTERNAL_SECRET === undefined) {
    console.log('Agent rollback skipped: no Hyperdrive or internal API configured');
    return false;
  }

  try {
    const rollbackUrl = `${env.INTERNAL_API_URL}/internal/agent-checkpoint-rollback`;

    const response = await fetch(rollbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_SECRET,
      },
      body: JSON.stringify({
        checkpointId,
        ownerId: owner.id,
        ownerType: owner.type,
        reason,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to rollback to checkpoint: ${String(response.status)} ${errorText}`);
      return false;
    }

    const rawResult: unknown = await response.json();
    const result = rawResult as {
      rolledBack: boolean;
      documentsReverted: number;
      documentsSkipped?: number;
    };
    const { rolledBack, documentsReverted, documentsSkipped } = result;
    console.log(`Rolled back to checkpoint ${checkpointId}, reverted ${String(documentsReverted)} documents`);
    if (documentsSkipped !== undefined && documentsSkipped > 0) {
      console.warn(
        `Rollback to checkpoint ${checkpointId} skipped ${String(documentsSkipped)} registry document(s)`,
      );
    }
    return rolledBack;
  } catch (error) {
    console.error('Error rolling back to checkpoint:', error);
    return false;
  }
}
