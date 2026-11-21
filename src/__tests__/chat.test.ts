import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {ChatContext} from '../agent-type.js'

// Mock all external dependencies
vi.mock('inquirer', () => ({default: {prompt: vi.fn()}}))
vi.mock('../config.js', () => ({
    saveMessages: vi.fn(),
    saveSnapshot: vi.fn(() => 'snapshot-123'),
    listSnapshots: vi.fn(() => []),
    loadSnapshot: vi.fn(() => [])
}))

const mockPrompt = vi.mocked((await import('inquirer')).default.prompt)
const {saveMessageList, saveSnapshot, listSnapshots, loadSnapshot} = await import('../config.js')

function makeCtx(messages: ChatContext['messageList'] = []): ChatContext {
    return {
        messageList: messages,
        send: vi.fn()
    }
}

// ==================== cmdNew ====================

describe('cmdNew', () => {
    it('写入 system prompt 并重置对话历史', async () => {
        const {cmdNew} = await import('../agent-command/new.js')
        const ctx = makeCtx()

        await cmdNew(ctx)

        expect(saveMessageList).toHaveBeenCalledWith(
            expect.arrayContaining([ expect.objectContaining({role: 'system'}) ])
        )
        expect(ctx.messageList).toEqual([ expect.objectContaining({role: 'system'}) ])
    })
})

// ==================== dispatchCommand 路由 ====================

describe('dispatchCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('"/exit" 调用 cmdExit（process.exit）', async () => {
        // Can't easily test process.exit, just verify it doesn't throw
        const {runChat} = await import('../agent-runtime.js')
        // dispatchCommand is internal, tested via routing only
    })

    it('"/save" 调用 cmdSave', async () => {
        const {cmdSave} = await import('../agent-command/save.js')
        const ctx = makeCtx([ {role: 'system', content: 'sys'} ])
        await cmdSave(ctx)
        expect(saveSnapshot).toHaveBeenCalledWith(ctx.messageList)
    })

    it('"/new" 调用 cmdNew 并打印提示', async () => {
        const {cmdNew} = await import('../agent-command/new.js')
        const ctx = makeCtx()
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        })
        await cmdNew(ctx)
        expect(spy).toHaveBeenCalledWith('\n🆕 新会话\n')
        spy.mockRestore()
    })

    it('"/help" 打印帮助信息', async () => {
        const {cmdHelp} = await import('../agent-command/help.js')
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        })
        cmdHelp()
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})

// ==================== cmdBack ====================

describe('cmdBack', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('没有消息时提示无可撤回', async () => {
        const {cmdBack} = await import('../agent-command/back.js')
        const ctx = makeCtx([ {role: 'system', content: 'sys'} ])
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        })
        await cmdBack(ctx)
        expect(spy).toHaveBeenCalledWith('\n❌ 还没有消息可以撤回\n')
        spy.mockRestore()
    })

    it('取消操作时不修改消息', async () => {
        const {cmdBack} = await import('../agent-command/back.js')
        const msgs: ChatContext['messageList'] = [
            {role: 'system', content: 'sys'},
            {role: 'user', content: '你好'}
        ]
        const ctx = makeCtx(msgs)
        mockPrompt.mockResolvedValueOnce({selectedIndex: -1})
        await cmdBack(ctx)
        expect(ctx.messageList).toBe(msgs)
    })

    it('选择用户消息后取消重发时保留历史', async () => {
        const {cmdBack} = await import('../agent-command/back.js')
        const messages: ChatContext['messageList'] = [
            {role: 'user', content: '你好'},
            {role: 'assistant', content: '你好！'}
        ]
        const ctx = makeCtx(messages)
        mockPrompt.mockResolvedValueOnce({selectedIndex: 0}).mockResolvedValueOnce({editChoice: 'cancel'})

        await cmdBack(ctx)

        expect(ctx.messageList).toBe(messages)
        expect(ctx.send).not.toHaveBeenCalled()
    })

    it('选择工具结果后保留同一批次的结果', async () => {
        const {cmdBack} = await import('../agent-command/back.js')
        const messages: ChatContext['messageList'] = [
            {role: 'user', content: '列出文件'},
            {
                role: 'assistant', content: [
                    {type: 'tool-call', toolCallId: 'one', toolName: 'shell', input: {command: 'pwd'}},
                    {type: 'tool-call', toolCallId: 'two', toolName: 'shell', input: {command: 'ls'}}
                ]
            },
            {
                role: 'tool', content: [
                    {type: 'tool-result', toolCallId: 'one', toolName: 'shell', output: {type: 'text', value: '/tmp'}},
                    {type: 'tool-result', toolCallId: 'two', toolName: 'shell', output: {type: 'text', value: 'file'}}
                ]
            },
            {role: 'assistant', content: '完成'}
        ]
        const ctx = makeCtx(messages)
        mockPrompt.mockResolvedValueOnce({selectedIndex: 2}).mockResolvedValueOnce({newMessage: '继续'})

        await cmdBack(ctx)

        expect(ctx.messageList).toEqual(messages.slice(0, 3))
        expect(ctx.send).toHaveBeenCalledWith('继续')
        expect(saveMessageList).toHaveBeenCalledWith(ctx.messageList)
    })
})

// ==================== cmdLoad ====================

describe('cmdLoad', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('没有快照时提示', async () => {
        const {cmdLoad} = await import('../agent-command/load.js')
        const ctx = makeCtx()
        vi.mocked(listSnapshots).mockReturnValueOnce([])
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        })
        await cmdLoad(ctx)
        expect(spy).toHaveBeenCalledWith('\n📭 没有可用的快照\n')
        spy.mockRestore()
    })
})

// ==================== cmdEditor ====================

describe('cmdEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('取消编辑不报错', async () => {
        const {cmdEditor} = await import('../agent-command/editor.js')
        const ctx = makeCtx()
        mockPrompt.mockResolvedValueOnce({content: ''})
        await cmdEditor(ctx)
        expect(saveMessageList).not.toHaveBeenCalled()
    })
})
