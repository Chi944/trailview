import oncallDigest from '../../../samples/oncall-digest.jsonl?raw'

export interface Sample {
  file: string
  title: string
  text: string
}

export const SAMPLES: Sample[] = [
  { file: 'oncall-digest.jsonl', title: 'On-call digest (retry, rejected and approved email)', text: oncallDigest },
]
