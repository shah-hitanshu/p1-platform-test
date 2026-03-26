import { runWithConnection } from '../db';
import {
  createCheckpoint as createCheckpointDirect,
  revertToCheckpoint as revertToCheckpointDirect,
} from '../services/checkpoint-service';
import type { DocumentSessionEnv, SessionInfo } from './document-session-types';

/**
 * Create a pre-edit checkpoint for an agent.
 * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
 */
export async function createAgentPreEditCheckpoint(
  env: DocumentSessionEnv,
  sessionInfo: SessionInfo,
  agentId: string,
  intent: string,
  trigger: 'human_requested' | 'autonomous',
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
            checkpointType: 'agent_pre_edit',
            createdById: agentId,
            createdByType: 'agent',
            description: `Pre-edit checkpoint: ${intent}`,
            trigger,
            affectedRegions: targetRegions,
            forceFullSnapshot: true,
          }),
      );
      console.log(`Created pre-edit checkpoint ${result.checkpoint.id} for agent ${agentId} (direct DB)`);
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
        agentId,
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
    console.log(`Created pre-edit checkpoint ${checkpointId} for agent ${agentId}`);
    return checkpointId;
  } catch (error) {
    console.error('Error creating pre-edit checkpoint:', error);
    return undefined;
  }
}

/**
 * Create a post-edit checkpoint for an agent.
 * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
 */
export async function createAgentPostEditCheckpoint(
  env: DocumentSessionEnv,
  sessionInfo: SessionInfo,
  agentId: string,
  intent: string,
  preEditCheckpointId: string,
  affectedRegions: string[],
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
            checkpointType: 'agent_post_edit',
            createdById: agentId,
            createdByType: 'agent',
            description: `Post-edit checkpoint: ${intent}`,
            trigger: 'autonomous',
            affectedRegions,
          }),
      );
      console.log(`Created post-edit checkpoint ${result.checkpoint.id} for agent ${agentId} (direct DB)`);
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
        agentId,
        intent,
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
    console.log(`Created post-edit checkpoint ${checkpointId} for agent ${agentId}`);
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
export async function rollbackToAgentCheckpoint(
  env: DocumentSessionEnv,
  sessionInfo: SessionInfo,
  checkpointId: string,
  agentId: string,
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
            createdById: agentId,
            createdByType: 'agent',
            message: reason,
          }),
      );
      const reverted = String(result.documentsReverted);
      console.log(`Rolled back to checkpoint ${checkpointId}, reverted ${reverted} docs (direct DB)`);
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
        agentId,
        reason,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to rollback to checkpoint: ${String(response.status)} ${errorText}`);
      return false;
    }

    const rawResult: unknown = await response.json();
    const result = rawResult as { rolledBack: boolean; documentsReverted: number };
    const { rolledBack, documentsReverted } = result;
    console.log(`Rolled back to checkpoint ${checkpointId}, reverted ${String(documentsReverted)} documents`);
    return rolledBack;
  } catch (error) {
    console.error('Error rolling back to checkpoint:', error);
    return false;
  }
}
