export type Msg =
  | { role: 'user'; text: string; checkpointId?: string }
  | { role: 'assistant'; text: string; checkpointId?: string; durationMs?: number; interrupted?: boolean }
  | { role: 'thinking'; id: string; text: string; streaming?: boolean }
  | {
      role: 'tool'
      name: string
      id?: string
      verb?: string
      target?: string
      body?: string
      streaming?: boolean
      system?: boolean
    }
