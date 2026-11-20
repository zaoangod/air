import type {AssistantModelMessage, ModelMessage} from 'ai'
import {modelMessageSchema} from 'ai'
import {z} from 'zod'

const legacyFunction = z.object({name: z.string(), arguments: z.string()})
const legacyMessage = z.object({
    role: z.enum([ 'system', 'user', 'assistant', 'tool', 'function' ]),
    content: z.unknown(),
    status: z.string().nullish(),
    omit: z.boolean().optional(),
    reasoning_content: z.string().nullish(),
    tool_calls: z.array(z.object({id: z.string(), function: legacyFunction})).nullish(),
    function_call: legacyFunction.nullish(),
    tool_call_id: z.string().nullish()
})

function parseToolInput(args: string): unknown {
    try {
        return JSON.parse(args)
    } catch {
        return args
    }
}

export function parseMessageHistory(data: unknown): ModelMessage[] {
    if (!Array.isArray(data)) return []

    const messages: ModelMessage[] = []
    const legacyCalls = new Map<string, {name: string; complete: boolean}>()
    let legacyFunctionId: string | undefined

    for (const [ index, entry ] of data.entries()) {
        const parsed = modelMessageSchema.safeParse(entry)
        const {data: legacy} = legacyMessage.safeParse(entry)
        if (legacy?.omit || (legacy?.status && legacy.status !== 'completed')) continue

        if (legacy?.role === 'assistant' && (legacy.reasoning_content || legacy.tool_calls?.length || legacy.function_call)) {
            const calls = [ ...legacy.tool_calls ?? [] ]
            if (legacy.function_call) {
                legacyFunctionId = `legacy-function-${ index }`
                calls.push({id: legacyFunctionId, function: legacy.function_call})
            }
            const content: Exclude<AssistantModelMessage['content'], string> = []
            if (legacy.reasoning_content) content.push({type: 'reasoning', text: legacy.reasoning_content})
            if (parsed.data?.role === 'assistant') {
                const text = parsed.data.content
                if (typeof text === 'string') {
                    if (text) content.push({type: 'text', text})
                } else {
                    content.push(...text)
                }
            }
            for (const call of calls) {
                legacyCalls.set(call.id, {name: call.function.name, complete: false})
                content.push({type: 'tool-call', toolCallId: call.id, toolName: call.function.name, input: parseToolInput(call.function.arguments)})
            }
            messages.push({role: 'assistant', content})
        } else if (legacy?.role === 'function' || (legacy?.role === 'tool' && legacy.tool_call_id)) {
            const id = legacy.role === 'function' ? legacyFunctionId : legacy.tool_call_id
            const call = id ? legacyCalls.get(id) : undefined
            if (!id || !call || call.complete || typeof legacy.content !== 'string') continue

            const previous = messages.at(-1)
            const result = {type: 'tool-result', toolCallId: id, toolName: call.name, output: {type: 'text', value: legacy.content}} as const
            if (previous?.role === 'tool') previous.content.push(result)
            else messages.push({role: 'tool', content: [ result ]})
            call.complete = true
        } else if (parsed.success) {
            messages.push(parsed.data)
        }
    }

    // Older snapshots can stop midway through a set of tool results.
    return messages.filter(message => {
        if (message.role !== 'assistant' || typeof message.content === 'string') return true
        message.content = message.content.filter(part => part.type !== 'tool-call' || legacyCalls.get(part.toolCallId)?.complete !== false)
        return message.content.length > 0
    })
}
