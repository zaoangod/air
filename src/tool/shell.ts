import {z} from 'zod'
import {type Tool, tool} from 'ai'
import {execSync} from 'node:child_process'

export const shell: Tool<{command: string}, string> = tool({
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
