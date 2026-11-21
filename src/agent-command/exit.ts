import type {ChatContext} from '../agent-type.js'

export async function cmdExit(ctx: ChatContext): Promise<void> {
    console.log('\n👋 再见！')
    process.exit(0)
}
