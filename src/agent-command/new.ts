import type {ChatContext} from '../agent-type.js'
import {saveMessageList} from '../config.js'
import {SYSTEM_PROMPT} from '../agent-constant.js'

export async function cmdNew(ctx: ChatContext): Promise<void> {
    const messages: ChatContext['messageList'] = [ {role: 'system', content: SYSTEM_PROMPT} ]
    saveMessageList(messages)
    ctx.messageList = messages
    console.log('\n🆕 新会话\n')
}
