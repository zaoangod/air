import type {Tool} from 'ai'
import {tool} from 'ai'
import {execSync} from 'node:child_process'
import {z} from 'zod'

export const tools: {shell: Tool<{command: string}, string>} = {
    shell: tool({
        description: '执行 shell 命令并返回输出',
        inputSchema: z.object({command: z.string().describe('要执行的命令')}),
        execute({command}) {
            try {
                return execSync(command, {encoding: 'utf-8', timeout: 30000})
            } catch (error) {
                return `错误: ${ error instanceof Error ? error.message : String(error) }`
            }
        }
    })
}
