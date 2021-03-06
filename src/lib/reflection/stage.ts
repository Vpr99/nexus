export const REFLECTION_ENV_VAR = 'NEXUS_REFLECTION'

export type ReflectionType = 'plugin' | 'typegen'

/**
 * Set the NEXUS_REFLECTION environment variable
 */
export function saveReflectionStageEnv(type: ReflectionType) {
  return {
    [REFLECTION_ENV_VAR]: type,
  }
}

/**
 * Check whether the app is executing in its reflection stage
 */
export function isReflectionStage(type: ReflectionType) {
  return process.env[REFLECTION_ENV_VAR] === type
}
