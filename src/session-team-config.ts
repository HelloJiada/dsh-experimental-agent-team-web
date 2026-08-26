import { z } from 'zod'

export interface SessionTeamModelPolicy {
  readonly provider: string
  readonly model: string
  readonly minReasoningEffort: string
  readonly maxReasoningEffort: string
}

export interface SessionTeamConfigSnapshot {
  readonly version: 1
  readonly enabled: boolean
  readonly maxWorkers: number
  readonly modelPool: readonly SessionTeamModelPolicy[]
}

export interface SessionTeamReasoningEffortView {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface SessionTeamModelView {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly efforts: readonly SessionTeamReasoningEffortView[]
  readonly defaultEffort?: string
  readonly selectable: boolean
  readonly unavailableReason?: string
}

export interface SessionTeamProviderView {
  readonly id: string
  readonly name: string
  readonly models: readonly SessionTeamModelView[]
}

export interface SessionTeamCatalogFailureView {
  readonly provider: string
  readonly message: string
}

export interface SessionTeamChildEffortCapabilityView {
  readonly status: 'supported' | 'unsupported'
  readonly reason?: string
}

export interface SessionTeamModelCatalogView {
  readonly providers: readonly SessionTeamProviderView[]
  readonly failures: readonly SessionTeamCatalogFailureView[]
  readonly childEffortCapability: SessionTeamChildEffortCapabilityView
  readonly refreshedAt: number
}

export interface SessionTeamConfigMutationView {
  readonly requestId: string
  readonly kind: 'saved' | 'rejected' | 'catalog-refreshed'
  readonly message?: string
}

export interface SessionTeamConfigView {
  readonly revision: number
  readonly config: SessionTeamConfigSnapshot
  readonly catalog: SessionTeamModelCatalogView | null
  readonly lastMutation: SessionTeamConfigMutationView | null
}

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const sessionTeamModelPolicySchema: z.ZodType<SessionTeamModelPolicy> = strictObject({
  provider: z.string(),
  model: z.string(),
  minReasoningEffort: z.string(),
  maxReasoningEffort: z.string(),
})

export const sessionTeamConfigSnapshotSchema: z.ZodType<SessionTeamConfigSnapshot> = strictObject({
  version: z.literal(1),
  enabled: z.boolean(),
  maxWorkers: z.number().int().min(1).max(8),
  modelPool: z.array(sessionTeamModelPolicySchema),
})

export const sessionTeamReasoningEffortViewSchema: z.ZodType<SessionTeamReasoningEffortView> = strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
})

export const sessionTeamModelViewSchema: z.ZodType<SessionTeamModelView> = strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  efforts: z.array(sessionTeamReasoningEffortViewSchema),
  defaultEffort: z.string().optional(),
  selectable: z.boolean(),
  unavailableReason: z.string().optional(),
})

export const sessionTeamProviderViewSchema: z.ZodType<SessionTeamProviderView> = strictObject({
  id: z.string(),
  name: z.string(),
  models: z.array(sessionTeamModelViewSchema),
})

export const sessionTeamCatalogFailureViewSchema: z.ZodType<SessionTeamCatalogFailureView> = strictObject({
  provider: z.string(),
  message: z.string(),
})

export const sessionTeamChildEffortCapabilityViewSchema: z.ZodType<SessionTeamChildEffortCapabilityView> = strictObject({
  status: z.enum(['supported', 'unsupported']),
  reason: z.string().optional(),
})

export const sessionTeamModelCatalogViewSchema: z.ZodType<SessionTeamModelCatalogView> = strictObject({
  providers: z.array(sessionTeamProviderViewSchema),
  failures: z.array(sessionTeamCatalogFailureViewSchema),
  childEffortCapability: sessionTeamChildEffortCapabilityViewSchema,
  refreshedAt: z.number(),
})

export const sessionTeamConfigMutationViewSchema: z.ZodType<SessionTeamConfigMutationView> = strictObject({
  requestId: z.string(),
  kind: z.enum(['saved', 'rejected', 'catalog-refreshed']),
  message: z.string().optional(),
})

export const sessionTeamConfigViewSchema: z.ZodType<SessionTeamConfigView> = strictObject({
  revision: z.number(),
  config: sessionTeamConfigSnapshotSchema,
  catalog: sessionTeamModelCatalogViewSchema.nullable(),
  lastMutation: sessionTeamConfigMutationViewSchema.nullable(),
})

export const DEFAULT_SESSION_TEAM_CONFIG: SessionTeamConfigSnapshot = {
  version: 1,
  enabled: false,
  maxWorkers: 4,
  modelPool: [],
}

export type SessionTeamConfigValidation =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code:
        | 'empty-model-pool'
        | 'unknown-model'
        | 'model-not-selectable'
        | 'unsupported-effort'
        | 'invalid-effort-range'
        | 'child-effort-unsupported'
      readonly message: string
    }

function invalid(
  code: Exclude<SessionTeamConfigValidation, { readonly ok: true }>['code'],
  message: string,
): SessionTeamConfigValidation {
  return { ok: false, code, message }
}

export function validateSessionTeamConfig(
  config: SessionTeamConfigSnapshot,
  catalog: SessionTeamModelCatalogView,
): SessionTeamConfigValidation {
  if (!config.enabled) return { ok: true }
  if (config.modelPool.length === 0) return invalid('empty-model-pool', 'Enabled Team sessions require at least one model.')
  if (catalog.childEffortCapability.status === 'unsupported') {
    return invalid('child-effort-unsupported', catalog.childEffortCapability.reason ?? 'Child reasoning-effort selection is unsupported.')
  }

  for (const policy of config.modelPool) {
    const provider = catalog.providers.find(candidate => candidate.id === policy.provider)
    const model = provider?.models.find(candidate => candidate.id === policy.model)
    if (model === undefined) return invalid('unknown-model', `Unknown model: ${policy.provider}/${policy.model}.`)
    if (!model.selectable) return invalid('model-not-selectable', model.unavailableReason ?? `Model is not selectable: ${policy.provider}/${policy.model}.`)

    const minimum = model.efforts.findIndex(effort => effort.id === policy.minReasoningEffort)
    const maximum = model.efforts.findIndex(effort => effort.id === policy.maxReasoningEffort)
    if (minimum < 0 || maximum < 0) return invalid('unsupported-effort', `Unsupported reasoning effort for ${policy.provider}/${policy.model}.`)
    if (minimum > maximum) return invalid('invalid-effort-range', `Minimum reasoning effort must not follow maximum for ${policy.provider}/${policy.model}.`)
  }

  return { ok: true }
}
