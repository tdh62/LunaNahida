import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildConverter, converterSource } from './build-converter.mjs';
import { projectRoot } from './version.mjs';

const directory = buildConverter();
const executable = join(directory, process.platform === 'win32' ? 'LunaNahida.Converter.exe' : 'LunaNahida.Converter');
const fixtures = join(projectRoot, 'bin/converter-integration-fixtures');
function run(args, cwd, env) {
  const result = spawnSync('go', args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Converter integration verification failed (${result.status}).`);
}
run(['test', './internal/musicrestore', '-run', '^TestExportIntegrationFixtures$', '-count=1'], converterSource, { LUNANAHIDA_EXPORT_FIXTURES: fixtures });
run(['test', './backend', '-run', '^TestRealConverterIntegration$', '-count=1', '-v'], projectRoot, { LUNANAHIDA_TEST_CONVERTER: executable, LUNANAHIDA_TEST_FIXTURES: fixtures });
