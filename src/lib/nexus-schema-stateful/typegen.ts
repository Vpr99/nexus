import * as NexusSchema from '@nexus/schema'
import { NexusSchemaExtensionConfig } from '@nexus/schema/dist/extensions'
import { stripIndent, stripIndents } from 'common-tags'
import * as FS from 'fs-jetpack'
import * as Lo from 'lodash'
import * as Path from 'path'
import * as Schema from '../../runtime/schema'
import * as Layout from '../layout'
import * as Logger from '../nexus-logger'
import * as Plugin from '../plugin'

const log = Logger.rootLogger.child('schema-typegen')

export const NEXUS_DEFAULT_TYPEGEN_PATH = FS.path('node_modules', '@types', 'typegen-nexus', 'index.d.ts')

interface GenerateArtifactsParams {
  graphqlSchema: NexusSchema.core.NexusGraphQLSchema
  schemaSettings: Schema.SettingsData
  layout: Layout.Layout
  plugins: Plugin.RuntimeContributions[]
}

export async function generateArtifacts(params: GenerateArtifactsParams): Promise<void> {
  const typegenConfig = resolveTypegenConfig(params)
  const typegenMetadata = new NexusSchema.core.TypegenMetadata(typegenConfig)

  await typegenMetadata.generateArtifacts(params.graphqlSchema)
}

function resolveTypegenConfig(params: GenerateArtifactsParams) {
  const schemaConfig = params.graphqlSchema.extensions.nexus.config

  schemaConfig.outputs = {
    typegen: NEXUS_DEFAULT_TYPEGEN_PATH,
    schema: getOutputSchemaPath(params),
  }

  schemaConfig.shouldGenerateArtifacts = true

  const schemaConfigWithTypegen = withCustomTypegenConfig(schemaConfig, params.plugins)

  return NexusSchema.core.resolveTypegenConfig(schemaConfigWithTypegen)
}

function getOutputSchemaPath(params: GenerateArtifactsParams) {
  const settings = params.schemaSettings

  if (settings.generateGraphQLSDLFile === undefined || settings.generateGraphQLSDLFile === false) {
    return false
  }

  if (Path.isAbsolute(settings.generateGraphQLSDLFile)) {
    return settings.generateGraphQLSDLFile
  }

  return params.layout.projectPath(settings.generateGraphQLSDLFile)
}

function withCustomTypegenConfig(
  nexusConfig: NexusSchemaExtensionConfig,
  plugins: Plugin.RuntimeContributions[]
) {
  // Integrate plugin typegenAutoConfig contributions
  const typegenAutoConfigFromPlugins = {}
  for (const p of plugins) {
    if (p.schema?.typegenAutoConfig) {
      Lo.merge(typegenAutoConfigFromPlugins, p.schema.typegenAutoConfig)
    }
  }

  const typegenAutoConfigObject = Lo.merge({}, typegenAutoConfigFromPlugins, nexusConfig.typegenAutoConfig!)
  nexusConfig.typegenAutoConfig = undefined

  function contextTypeContribSpecToCode(ctxTypeContribSpec: Record<string, string>): string {
    return stripIndents`
      interface Context {
        ${Object.entries(ctxTypeContribSpec)
          .map(([name, type]) => {
            // Quote key name to handle case of identifier-incompatible key names
            return `'${name}': ${type}`
          })
          .join('\n')}
      }
    `
  }

  // Our use-case of multiple context sources seems to require a custom
  // handling of typegenConfig. Opened an issue about maybe making our
  // curreent use-case, fairly basic, integrated into the auto system, here:
  // https://github.com/prisma-labs/nexus/issues/323
  nexusConfig.typegenConfig = async (schema, outputPath) => {
    const configurator = await NexusSchema.core.typegenAutoConfig(typegenAutoConfigObject)
    const config = await configurator(schema, outputPath)

    // Initialize
    config.imports.push('interface Context {}')
    config.imports.push(stripIndent`
      declare global {
        interface NexusContext extends Context {}
      }
    `)
    config.contextType = 'NexusContext'

    // Integrate plugin context contributions
    for (const p of plugins) {
      if (!p.context) continue

      if (p.context.typeGen.imports) {
        config.imports.push(
          ...p.context.typeGen.imports.map((im) => `import * as ${im.as} from '${im.from}'`)
        )
      }

      config.imports.push(contextTypeContribSpecToCode(p.context.typeGen.fields))
    }

    config.imports.push(
      "import * as Logger from 'nexus/components/logger'",
      contextTypeContribSpecToCode({
        log: 'Logger.Logger',
      })
    )

    config.nexusSchemaImportId = 'nexus/components/schema'

    log.trace('built up Nexus typegenConfig', { config })
    return config
  }

  return nexusConfig
}
