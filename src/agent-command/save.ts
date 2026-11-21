import type {ChatContext} from '../agent-type.js'
import {saveSnapshot} from '../config.js'

export async function cmdSave(ctx: ChatContext) {
    console.log(`\n✅ 快照: ${ saveSnapshot(ctx.messageList) }\n`)
}
