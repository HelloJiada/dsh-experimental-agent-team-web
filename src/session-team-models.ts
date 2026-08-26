import * as dshAgent from '@deepseek-ai/dsh-agent'
import type {
  SessionTeamChildEffortCapabilityView,
  SessionTeamModelCatalogView,
  SessionTeamModelView,
  SessionTeamProviderView,
  SessionTeamReasoningEffortView,
} from './session-team-config.js'

interface SessionTeamDirectoryProvider {
  readonly id: string
  readonly name: string
}

interface SessionTeamDirectoryModel {
  readonly id: string
  readonly name: string
}

interface SessionTeamDirectoryEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

interface SessionTeamDirectoryResolvedModel extends SessionTeamDirectoryModel {
  readonly description?: string
  readonly reasoning?: {
    readonly efforts: readonly SessionTeamDirectoryEffort[]
    readonly defaultEffort?: string
  }
}

/** A narrow, read-only subset of the Host LLM directory used for Team configuration. */
export interface SessionTeamLlmDirectory {
  listProviders(): readonly SessionTeamDirectoryProvider[]
  listModels(provider: string): Promise<readonly SessionTeamDirectoryModel[]> | readonly SessionTeamDirectoryModel[]
  resolveModelInfo(provider: string, model: string): Promise<SessionTeamDirectoryResolvedModel> | SessionTeamDirectoryResolvedModel
}

export interface LoadSessionTeamModelCatalogOptions {
  readonly now?: () => number
  readonly childEffortCandidate?: unknown
}

/**
 * Checks only whether the locked Host supports installing an effort selection while creating a child.
 * Phase 1 does not prove or promise hot mutation of existing children.
 */
export function detectChildEffortCapability(
  candidate?: unknown,
): SessionTeamChildEffortCapabilityView {
  const installer = arguments.length === 0 ? dshAgent.installModelSelection : candidate
  if (typeof installer === 'function') return { status: 'supported' }
  return {
    status: 'unsupported',
    reason: 'Child reasoning-effort selection requires the Host installModelSelection export.',
  }
}

function unavailableReason(capability: SessionTeamChildEffortCapabilityView): string | undefined {
  return capability.status === 'unsupported'
    ? capability.reason ?? 'Child reasoning-effort selection is unsupported.'
    : undefined
}

function sanitizeFailure(scope: 'Provider' | 'Model'): string {
  return `${scope} model catalogue is unavailable.`
}

function detachEfforts(model: SessionTeamDirectoryResolvedModel): readonly SessionTeamReasoningEffortView[] {
  return (model.reasoning?.efforts ?? []).map(effort => ({
    id: effort.id,
    name: effort.name,
    ...(effort.description === undefined ? {} : { description: effort.description }),
  }))
}

function detachModel(
  model: SessionTeamDirectoryResolvedModel,
  capability: SessionTeamChildEffortCapabilityView,
): SessionTeamModelView {
  const efforts = detachEfforts(model)
  const reason = unavailableReason(capability)
  const selectable = efforts.length > 0 && reason === undefined
  return {
    id: model.id,
    name: model.name,
    ...(model.description === undefined ? {} : { description: model.description }),
    efforts,
    ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
    selectable,
    ...(selectable ? {} : { unavailableReason: reason ?? 'This model does not expose reasoning efforts.' }),
  }
}

export async function loadSessionTeamModelCatalog(
  llm: SessionTeamLlmDirectory,
  options: LoadSessionTeamModelCatalogOptions = {},
): Promise<SessionTeamModelCatalogView> {
  const childEffortCapability = detectChildEffortCapability(options.childEffortCandidate)
  const providers: SessionTeamProviderView[] = []
  const failures: SessionTeamModelCatalogView['failures'][number][] = []

  for (const provider of llm.listProviders()) {
    try {
      const listedModels = await llm.listModels(provider.id)
      const models: SessionTeamModelView[] = []
      for (const listedModel of listedModels) {
        try {
          const resolvedModel = await llm.resolveModelInfo(provider.id, listedModel.id)
          models.push(detachModel(resolvedModel, childEffortCapability))
        } catch {
          models.push({
            id: listedModel.id,
            name: listedModel.name,
            efforts: [],
            selectable: false,
            unavailableReason: sanitizeFailure('Model'),
          })
        }
      }
      providers.push({ id: provider.id, name: provider.name, models })
    } catch {
      failures.push({ provider: provider.id, message: sanitizeFailure('Provider') })
    }
  }

  return {
    providers,
    failures,
    childEffortCapability,
    refreshedAt: (options.now ?? Date.now)(),
  }
}
