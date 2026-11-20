import type {ModelMessage} from 'ai'

export interface ChatCtx {
    messages: ModelMessage[];
    send: (text: string) => Promise<void>;
}
