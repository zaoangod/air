import type {ChatCtx} from '../agent-types.js'
import {saveMessages} from '../config.js'
import {SYSTEM_PROMPT} from '../agent-constants.js'

export async function cmdNew(ctx: ChatCtx): Promise<void> {
    const messages: ChatCtx['messages'] = [ {role: 'system', content: SYSTEM_PROMPT} ]
    saveMessages(messages)
    ctx.messages = messages
    console.log('\n🆕 新会话\n')
}
