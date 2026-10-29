import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadConfigFromFile } from '@prisma/config'

// Prisma 6 pins deepmerge-ts 7. The security override must preserve the loader.
it('loads Prisma configuration with the corrected merge dependency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omnimark-prisma-config-'))
  const configFile = join(directory, 'prisma.config.ts')
  try {
    await writeFile(configFile, 'export default { schema: "schema.prisma", migrations: { path: "migrations" } }')
    const result = await loadConfigFromFile({ configRoot:directory, configFile })
    expect(result.error).toBeUndefined()
    expect(result.config?.schema).toBe(join(directory, 'schema.prisma'))
    expect(result.config?.migrations?.path).toBe(join(directory, 'migrations'))
  } finally { await unlink(configFile); await rmdir(directory) }
})
