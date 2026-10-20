import type { Run } from '../../core/model/run.ts'

export function runLabel(run: Run | undefined): string {
  if (!run) return 'this run'
  return run.agent ? `${run.agent.name}${run.agent.version ? ` ${run.agent.version}` : ''}` : run.id
}
