import type {ModelMessage} from 'ai'

export interface ChatContext {
    messageList: ModelMessage[];
    send: (text: string) => Promise<void>;
}
