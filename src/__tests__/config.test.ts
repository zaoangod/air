import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import type {ModelMessage} from 'ai'
import {clearMessages, listSnapshots, loadSnapshot, readConfig, readMessages, saveConfig, saveMessageList, saveSnapshot} from '../config.js'

describe('config', () => {
    let tempDir: string
    let origHome: string | undefined

    beforeEach(() => {
        tempDir = join(tmpdir(), `air-test-${ Date.now() }-${ Math.random().toString(36).slice(2) }`)
        mkdirSync(tempDir, {recursive: true})
        origHome = process.env.HOME
        process.env.HOME = tempDir
        vi.stubEnv('DEEPSEEK_API_KEY', '')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        if (origHome) process.env.HOME = origHome
        else delete process.env.HOME
        try {
            rmSync(tempDir, {recursive: true, force: true})
        } catch {
        }
    })

    describe('config (apiKey)', () => {
        it('默认 apiKey 为空', () => {
            expect(readConfig().apiKey).toBe('')
        })

        it('保存和读取 apiKey', () => {
            saveConfig('sk-test-key-12345')
            expect(readConfig().apiKey).toBe('sk-test-key-12345')
        })

        it('优先读取环境变量中的 apiKey，留空时读取已保存的值', () => {
            saveConfig('sk-test-saved')
            vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test-env')
            expect(readConfig().apiKey).toBe('sk-test-env')

            vi.stubEnv('DEEPSEEK_API_KEY', '')
            expect(readConfig().apiKey).toBe('sk-test-saved')
        })

        it('配置文件损坏时返回空 key', () => {
            mkdirSync(join(tempDir, '.ai-zen', 'air'), {recursive: true})
            writeFileSync(join(tempDir, '.ai-zen', 'air', 'config.json'), '不是JSON', 'utf-8')
            expect(readConfig().apiKey).toBe('')
        })
    })

    describe('context (messages 数组)', () => {
        it('不存在时返回空数组', () => {
            expect(readMessages()).toEqual([])
        })

        it('保存和读取 messages', () => {
            const msgs: ModelMessage[] = [
                {role: 'user', content: '你好'},
                {role: 'assistant', content: '你好！'}
            ]
            saveMessageList(msgs)
            expect(readMessages()).toEqual(msgs)
        })

        it('clearMessages 清空为 []', () => {
            saveMessageList([ {role: 'user', content: 'hi'} ])
            clearMessages()
            expect(readMessages()).toEqual([])
        })

        it('文件内容不是数组时返回空数组', () => {
            mkdirSync(join(tempDir, '.ai-zen', 'air'), {recursive: true})
            writeFileSync(join(tempDir, '.ai-zen', 'air', 'context.json'), '"不是数组"', 'utf-8')
            expect(readMessages()).toEqual([])
        })

        it('文件损坏时返回空数组', () => {
            mkdirSync(join(tempDir, '.ai-zen', 'air'), {recursive: true})
            writeFileSync(join(tempDir, '.ai-zen', 'air', 'context.json'), '不是JSON', 'utf-8')
            expect(readMessages()).toEqual([])
        })
    })

    describe('snapshots', () => {
        it('保存快照，文件名是 ISO 时间', () => {
            const msgs: ModelMessage[] = [ {role: 'user', content: '测试快照'} ]
            const name = saveSnapshot(msgs)
            expect(name).toBeTruthy()

            const snapDir = join(tempDir, '.ai-zen', 'air', 'snapshots')
            expect(existsSync(snapDir)).toBe(true)
            const files = readdirSync(snapDir).filter((f) => f.endsWith('.json'))
            expect(files.length).toBe(1)
            expect(files[0]).toBe(name + '.json')

            const loaded = JSON.parse(readFileSync(join(snapDir, files[0]), 'utf-8'))
            expect(loaded).toEqual(msgs)
        })
    })

    describe('listSnapshots / loadSnapshot', () => {
        it('加载不存在的快照返回空数组', () => {
            expect(loadSnapshot('nonexistent')).toEqual([])
        })

        it('保存后能列出并加载快照', () => {
            const msgs: ModelMessage[] = [ {role: 'user', content: '测试'} ]
            const name = saveSnapshot(msgs)

            const list = listSnapshots()
            expect(list.length).toBe(1)
            expect(list[0].name).toBe(name)
            expect(list[0].date).toBeTruthy()

            const loaded = loadSnapshot(name)
            expect(loaded).toEqual(msgs)
        })
    })

    it('读取旧上下文和快照时保留推理、工具调用和工具输出', () => {
        const airDir = join(tempDir, '.ai-zen', 'air')
        const snapshots = join(airDir, 'snapshots')
        mkdirSync(snapshots, {recursive: true})
        const original = JSON.stringify([
            {role: 'system', content: 'system', status: 'completed'},
            {role: 'user', content: '执行命令', status: 'completed'},
            {
                role: 'assistant', reasoning_content: '先检查目录', content: '', tool_calls: [
                    {id: 'call_1', type: 'function', function: {name: 'shell', arguments: '{"command":"pwd"}'}},
                    {id: 'call_2', type: 'function', function: {name: 'shell', arguments: '{"command":"ls"}'}},
                    {id: 'call_3', type: 'function', function: {name: 'shell', arguments: '{"command":"date"}'}}
                ]
            },
            {role: 'tool', tool_call_id: 'call_1', name: 'shell', content: '/tmp'},
            {role: 'tool', tool_call_id: 'call_2', name: 'shell', content: 'one.txt'},
            {role: 'assistant', status: 'error', content: '请求失败'}
        ])
        const contextFile = join(airDir, 'context.json')
        const snapshotFile = join(snapshots, 'legacy.json')
        writeFileSync(contextFile, original)
        writeFileSync(snapshotFile, original)

        const messages = readMessages()
        expect(messages).toEqual([
            {role: 'system', content: 'system'},
            {role: 'user', content: '执行命令'},
            {
                role: 'assistant', content: [
                    {type: 'reasoning', text: '先检查目录'},
                    {type: 'tool-call', toolCallId: 'call_1', toolName: 'shell', input: {command: 'pwd'}},
                    {type: 'tool-call', toolCallId: 'call_2', toolName: 'shell', input: {command: 'ls'}}
                ]
            },
            {
                role: 'tool', content: [
                    {type: 'tool-result', toolCallId: 'call_1', toolName: 'shell', output: {type: 'text', value: '/tmp'}},
                    {type: 'tool-result', toolCallId: 'call_2', toolName: 'shell', output: {type: 'text', value: 'one.txt'}}
                ]
            }
        ])
        expect(loadSnapshot('legacy')).toEqual(messages)
        expect(readFileSync(snapshotFile, 'utf-8')).toBe(original)

        saveMessageList(messages)
        expect(readMessages()).toEqual(messages)
    })
})
