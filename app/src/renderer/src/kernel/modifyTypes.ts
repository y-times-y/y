export type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
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
