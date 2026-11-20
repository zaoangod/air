import {afterAll, describe, expect, it} from 'vitest'
import {spawn} from 'node:child_process'
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {stripVTControlCharacters} from 'node:util'
import type {ModelMessage} from 'ai'
import {MAX_CONTEXT_CHARS} from '../migration.js'

// ==================== Helpers ====================

const CLI = join(process.cwd(), 'dist', 'cli.js')

interface CliResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

function runCli(args: string[], stdinInput?: string, extraEnv?: Record<string, string>): Promise<CliResult> {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            DEEPSEEK_API_KEY: '',
            ...extraEnv
        }

        const proc = spawn(process.execPath, [ CLI, ...args ], {env, stdio: [ 'pipe', 'pipe', 'pipe' ]})
        const lines = stdinInput?.trimEnd().split('\n') ?? []

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString()
            if (lines.length && stripVTControlCharacters(stdout).trimEnd().endsWith('你:')) {
                proc.stdin.write(`${ lines.shift() }\n`)
            }
        })
        proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
        })

        proc.on('close', (code) => {
            resolve({stdout, stderr, exitCode: code ?? -1})
        })
        proc.on('error', () => {
            resolve({stdout, stderr, exitCode: -1})
        })
    })
}

let tmpDirs: string[] = []

afterAll(() => {
    for (const d of tmpDirs) {
        try {
            rmSync(d, {recursive: true, force: true})
        } catch {
        }
    }
})

function makeTestDir(): string {
    const dir = join(tmpdir(), `air-e2e-${ Date.now() }-${ Math.random().toString(36).slice(2) }`)
    mkdirSync(dir, {recursive: true})
    tmpDirs.push(dir)
    return dir
}

// Read API key from .env.local
function getApiKey(): string {
    try {
        const envContent = readFileSync(join(process.cwd(), '.env.local'), 'utf-8')
        const match = envContent.match(/DEEPSEEK_API_KEY=(.+)/)
        if (match) return match[1].trim()
    } catch {
    }
    return process.env.DEEPSEEK_API_KEY || ''
}

const API_KEY = getApiKey()

function skipIfNoKey(ctx: any) {
    if (!API_KEY) ctx.skip()
}

// ==================== Tests ====================

describe('E2E: CLI 基本功能', () => {
    it('air --help 显示帮助信息', async () => {
        const result = await runCli([ '--help' ])
        expect(result.stdout).toContain('Usage:')
        expect(result.stdout).toContain('air')
        expect(result.exitCode).toBe(0)
    })

    it('air key <key> 设置 API Key', async () => {
        const airDir = makeTestDir()
        const result = await runCli([ 'key', 'sk-test-12345' ], undefined, {AIR_DIR: airDir})
        expect(result.stdout).toContain('✅ API Key 已设置')

        const configFile = join(airDir, 'config.json')
        expect(existsSync(configFile)).toBe(true)
        const config = JSON.parse(readFileSync(configFile, 'utf-8'))
        expect(config.apiKey).toBe('sk-test-12345')
    })

    it('air config 显示配置信息', async () => {
        const airDir = makeTestDir()
        await runCli([ 'key', 'sk-test-abcde' ], undefined, {AIR_DIR: airDir})
        const result = await runCli([ 'config' ], undefined, {AIR_DIR: airDir})
        expect(result.stdout).toContain('API Key:')
        expect(result.stdout).toContain('bcde')
    })
})

describe('E2E: Vercel AI SDK', () => {
    it('流式完成工具调用，恢复对话并通过同一端点迁移上下文', async () => {
        const requests: {path: string | undefined; auth: string | undefined; body: {messages: unknown[]; stream?: boolean; tools?: unknown[]}}[] = []
        const server = createServer(async (req, res) => {
            let body = ''
            for await (const chunk of req) body += chunk.toString()
            const request: (typeof requests)[number] = {path: req.url, auth: req.headers.authorization, body: JSON.parse(body)}
            requests.push(request)

            if (!request.body.stream) {
                res.writeHead(200, {'Content-Type': 'application/json'})
                res.end(JSON.stringify({choices: [ {message: {role: 'assistant', content: '交接摘要'}, finish_reason: 'stop'} ]}))
                return
            }

            const writeChunk = (delta: object, finishReason: string | null = null) => {
                res.write(`data: ${ JSON.stringify({choices: [ {index: 0, delta, finish_reason: finishReason} ]}) }\n\n`)
            }
            res.writeHead(200, {'Content-Type': 'text/event-stream'})
            if (requests.length === 1) {
                writeChunk({reasoning_content: '先执行命令。'})
                writeChunk({
                    tool_calls: [ {
                        index: 0,
                        id: 'call_air_test',
                        type: 'function',
                        function: {name: 'shell', arguments: '{"command":"printf air-test"}'}
                    } ]
                })
                writeChunk({}, 'tool_calls')
            } else {
                writeChunk({content: '命令执行完成。'})
                writeChunk({}, 'stop')
            }
            res.end('data: [DONE]\n\n')
        })

        server.listen(0, '127.0.0.1')
        try {
            await once(server, 'listening')
            const address = server.address()
            if (!address || typeof address === 'string') throw new Error('Mock server did not bind to a TCP port')
            const airDir = makeTestDir()
            const env = {AIR_DIR: airDir, AIR_API_ENDPOINT: `http://127.0.0.1:${ address.port }/v1`}
            await runCli([ 'key', 'sk-test-ai-sdk' ], undefined, env)
            const result = await runCli([ '执行测试命令' ], '/exit\n', env)

            expect(result.stderr).toBe('')
            expect(result.exitCode).toBe(0)
            expect(result.stdout).toContain('先执行命令。')
            expect(result.stdout).toContain('🔧 1 shell')
            expect(result.stdout).toContain('命令执行完成。')
            expect(requests).toHaveLength(2)
            expect(requests[0]).toMatchObject({path: '/v1/chat/completions', auth: 'Bearer sk-test-ai-sdk', body: {stream: true}})
            expect(requests[1].body.messages).toEqual(expect.arrayContaining([
                expect.objectContaining({role: 'assistant', reasoning_content: '先执行命令。'}),
                expect.objectContaining({role: 'tool', tool_call_id: 'call_air_test', content: 'air-test'})
            ]))
            const context = join(airDir, 'context.json')
            const messages: ModelMessage[] = JSON.parse(readFileSync(context, 'utf-8'))
            expect(messages).toEqual(expect.arrayContaining([
                expect.objectContaining({role: 'tool', content: [ expect.objectContaining({toolCallId: 'call_air_test'}) ]}),
                expect.objectContaining({role: 'assistant', content: [ expect.objectContaining({type: 'text', text: '命令执行完成。'}) ]})
            ]))

            writeFileSync(context, JSON.stringify([ ...messages, {role: 'user', content: 'a'.repeat(MAX_CONTEXT_CHARS)} ]))
            const resumed = await runCli([], '继续\n/exit\n', env)

            expect(resumed.exitCode).toBe(0)
            expect(resumed.stderr).toBe('')
            expect(resumed.stdout).toContain('✅ 迁移完成')
            expect(requests).toHaveLength(4)
            expect(requests[2].body.messages).toEqual(expect.arrayContaining([
                expect.objectContaining({role: 'assistant', reasoning_content: '先执行命令。'}),
                expect.objectContaining({role: 'tool', tool_call_id: 'call_air_test', content: 'air-test'}),
                expect.objectContaining({role: 'user', content: '继续'})
            ]))
            expect(requests[3]).toMatchObject({path: '/v1/chat/completions', auth: 'Bearer sk-test-ai-sdk'})
            expect(requests[3].body.stream).not.toBe(true)
            expect(requests[3].body.tools).toBeUndefined()
            expect(readdirSync(join(airDir, 'snapshots'))).toHaveLength(1)
            expect(JSON.parse(readFileSync(context, 'utf-8'))).toEqual([
                expect.objectContaining({role: 'system'}),
                {role: 'user', content: '交接摘要'}
            ])
        } finally {
            server.close()
            server.closeAllConnections()
        }
    })
})

describe('E2E: 对话命令', () => {
    it('/save 保存快照', async (ctx) => {
        skipIfNoKey(ctx)

        const airDir = makeTestDir()
        const env = {AIR_DIR: airDir}
        await runCli([ 'key', API_KEY ], undefined, env)

        // 先发一条消息建立历史
        await runCli([ '测试消息' ], '/exit\n', env)

        // 交互模式下 /save 后 /exit
        const result = await runCli([], '/save\n/exit\n', env)
        expect(result.stdout).toContain('✅ 快照:')

        // 验证快照文件被创建
        const snapDir = join(airDir, 'snapshots')
        const files = readdirSync(snapDir).filter((f) => f.endsWith('.json'))
        expect(files.length).toBeGreaterThanOrEqual(1)
    }, 30000)
})

describe('E2E: 真实 API 对话', () => {
    it('air <message> 发送消息并接收真实回复', async (ctx) => {
        skipIfNoKey(ctx)

        const airDir = makeTestDir()
        const env = {AIR_DIR: airDir}

        // Set up real key
        await runCli([ 'key', API_KEY ], undefined, env)

        // Send a simple message, pipe /exit to leave interactive mode
        const result = await runCli([ '用一句话介绍你自己' ], '/exit\n', env)

        // Should have AI response
        expect(result.stdout).toContain('🤖 AI:')
        // Should have some actual content (not empty)
        expect(result.stdout.length).toBeGreaterThan(100)

        // Verify context was saved with user message + AI response
        const contextFile = join(airDir, 'context.json')
        expect(existsSync(contextFile)).toBe(true)
        const msgs: ModelMessage[] = JSON.parse(readFileSync(contextFile, 'utf-8'))
        expect(msgs.length).toBeGreaterThanOrEqual(2)
        expect(msgs[1].role).toBe('user')
        expect(msgs[1].content).toBe('用一句话介绍你自己')

        // Verify there's an assistant response
        const assistantText = msgs.flatMap(message => {
            if (message.role !== 'assistant') return []
            if (typeof message.content === 'string') return [ message.content ]
            return message.content.flatMap(part => part.type === 'text' ? [ part.text ] : [])
        }).join('')
        expect(assistantText.length).toBeGreaterThan(10)
    }, 30000)  // 30s timeout for real API

    it('/new 命令重置对话', async (ctx) => {
        skipIfNoKey(ctx)

        const airDir = makeTestDir()
        const env = {AIR_DIR: airDir}

        await runCli([ 'key', API_KEY ], undefined, env)

        // Send a message to create history
        await runCli([ '第一轮消息' ], '/exit\n', env)

        // Verify there's history
        let contextFile = join(airDir, 'context.json')
        let msgs = JSON.parse(readFileSync(contextFile, 'utf-8'))
        expect(msgs.length).toBeGreaterThanOrEqual(2)

        // Interactive mode: /new then exit
        const result = await runCli([], '/new\n/exit\n', env)
        expect(result.stdout).toContain('🆕 新会话')

        // Verify context was reset
        msgs = JSON.parse(readFileSync(contextFile, 'utf-8'))
        expect(msgs.length).toBe(1)
        expect(msgs[0].role).toBe('system')
    }, 30000)
})
