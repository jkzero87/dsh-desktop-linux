// Boot the installed Desktop Host's profile headless, as dsh-desktop-host does, and fail when a profile
// bundle was skipped or a required tool is not registered. The Desktop shell keeps Host stderr only for
// crash reports, so a bundle skipped for compatibility otherwise disappears without any visible message.
//
// Run under the installed executable with ELECTRON_RUN_AS_NODE=1 and DSH_HOME set:
//   linux-profile-smoke.mjs <runtimeDir> <profileDir> <requiredTool,...>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtimeDir, profileDir, requiredList] = process.argv.slice(2)
if (runtimeDir === undefined || profileDir === undefined || requiredList === undefined) {
  process.stderr.write('usage: linux-profile-smoke.mjs <runtimeDir> <profileDir> <requiredTool,...>\n')
  process.exit(2)
}
const modules = join(runtimeDir, 'node_modules', '@deepseek-ai')
const appBoot = await import(pathToFileURL(join(modules, 'dsh-app-boot', 'lib', 'index.js')).href)
const { runProfile } = await import(pathToFileURL(join(modules, 'dsh', 'lib', 'profile-boot.js')).href)

const installAnchor = join(modules, 'dsh', 'package.json')
const runtimeVersion = appBoot.getDshRuntimeVersion()
const profile = appBoot.loadProfileDirectory('dsh', profileDir, installAnchor)
const exemptions = appBoot.readProfileVersionExemptions(profileDir)
const compatibilityFile = join(profileDir, appBoot.PROFILE_COMPATIBILITY_FILENAME)
const failures = []

for (const { packageName, reason } of profile.skippedBundles) {
  let manifest
  try { manifest = JSON.parse(readFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8')) }
  catch (error) {
    failures.push(`bundle ${packageName} was skipped and its package.json cannot be read (${String(error)}): ${reason}`)
    continue
  }
  const issue = appBoot.evaluatePluginCompatibility(manifest, exemptions)
  if (issue === undefined || issue.exempted) {
    failures.push(`bundle ${packageName}@${manifest.version} was skipped: ${reason}`)
    continue
  }
  const key = `${issue.name}@${issue.version}`
  failures.push(`bundle ${key} was skipped for compatibility with DSH ${runtimeVersion} `
    + `(unmet ${JSON.stringify(issue.requirements)}). If this plugin version is known to work, add `
    + `"${runtimeVersion}" to the "${key}" list in ${compatibilityFile}.`)
}

// The required tools are registered by bundles; a missing one with no skipped bundle means a row-level denial
// or a plugin failure during boot, which the Host stderr above reports.
// The Desktop shell supplies the version the web-app bundle's product-telemetry row requires.
process.env.DSH_CLIENT_VERSION ??= runtimeVersion
const application = await runProfile({
  environment: appBoot.loadLayeredEnv('dsh'),
  profile: 'desktop',
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
})
const tools = application.ctx.get('tools')
const missing = requiredList.split(',').filter(name => name !== '' && tools.get(name) === undefined)
if (missing.length > 0) failures.push(`required tools are not registered: ${missing.join(', ')}`)

if (failures.length === 0) {
  process.stdout.write(`linux profile smoke: DSH ${runtimeVersion}, ${profile.layers.length} bundles loaded, `
    + `tools present: ${requiredList}\n`)
} else {
  process.stderr.write(`linux profile smoke FAILED (DSH ${runtimeVersion}, profile ${profileDir}):\n`
    + failures.map(failure => `  - ${failure}\n`).join(''))
}
await application.shutdown.shutdown(failures.length === 0 ? 0 : 1)
