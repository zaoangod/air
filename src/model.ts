import {createDeepSeek} from '@ai-sdk/deepseek'
import type {LanguageModel} from 'ai'

const MODEL_NAME = 'deepseek-v4-flash'

export function createModel(apiKey: string): LanguageModel {
    const deepseek = createDeepSeek({
        apiKey,
        baseURL: process.env.AIR_API_ENDPOINT || 'https://api.deepseek.com/v1'
    })
    return deepseek.chat(MODEL_NAME)
}
