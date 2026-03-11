import { runRegisterBatchCli } from './registerBatchCli.ts'

process.exitCode = await runRegisterBatchCli(process.argv.slice(2))
